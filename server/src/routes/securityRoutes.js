import { Router } from "express";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { emitSecurityEvent } from "../security/events.js";
import { getSetting } from "./rangeControlRoutes.js";

const router = Router();

// Gate the whole SOC surface behind the range-control toggle.
// SUPERADMIN bypasses the toggle so they can always see the dashboard.
router.use(async (req, res, next) => {
  const user = req.session?.authUser;
  if (user?.role === "SUPERADMIN") return next();
  const enabled = await getSetting("soc_dashboard_enabled");
  if (enabled === "false") {
    return res.status(404).json({ message: "SOC dashboard is disabled for this exercise." });
  }
  next();
});

// Real-time threat dashboard data
router.get("/dashboard", requirePermission(permissions.AUDIT_READ), async (req, res) => {
  const last1h = new Date(Date.now() - 60 * 60 * 1000);
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    failedLogins1h,
    failedLogins24h,
    lockouts24h,
    suspiciousEvents24h,
    totalEvents24h,
    recentCritical,
    topAttackerIPs,
    eventsByCategory,
    eventsBySeverity,
    loginAttemptsByHour,
    debugEndpointAccess24h,
    idorAttempts24h
  ] = await Promise.all([
    // Failed logins in last hour (spike detection)
    prisma.auditLog.count({
      where: { action: "auth_login_failed", createdAt: { gte: last1h } }
    }),
    // Failed logins in 24h
    prisma.auditLog.count({
      where: { action: "auth_login_failed", createdAt: { gte: last24h } }
    }),
    // Account lockouts
    prisma.auditLog.count({
      where: { action: "auth_account_locked", createdAt: { gte: last24h } }
    }),
    // Suspicious events
    prisma.auditLog.count({
      where: {
        action: { startsWith: "suspicious_" },
        createdAt: { gte: last24h }
      }
    }),
    // Total audit events
    prisma.auditLog.count({
      where: { createdAt: { gte: last24h } }
    }),
    // Recent critical/warning events
    prisma.auditLog.findMany({
      where: {
        severity: { in: ["critical", "warning"] },
        createdAt: { gte: last24h }
      },
      include: {
        actor: { select: { id: true, username: true, role: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    // Top attacker IPs (by failed login count)
    prisma.auditLog.groupBy({
      by: ["ip"],
      where: {
        action: "auth_login_failed",
        createdAt: { gte: last24h },
        ip: { not: null }
      },
      _count: { _all: true },
      orderBy: { _count: { ip: "desc" } },
      take: 10
    }),
    // Events by category
    prisma.auditLog.groupBy({
      by: ["category"],
      where: { createdAt: { gte: last24h } },
      _count: { _all: true }
    }),
    // Events by severity
    prisma.auditLog.groupBy({
      by: ["severity"],
      where: { createdAt: { gte: last24h } },
      _count: { _all: true }
    }),
    // Login attempts grouped by hour (last 24h) for timeline chart
    prisma.auditLog.findMany({
      where: {
        action: { in: ["auth_login_attempt", "auth_login_failed", "auth_login_success"] },
        createdAt: { gte: last24h }
      },
      select: { action: true, createdAt: true },
      orderBy: { createdAt: "asc" }
    }),
    // Debug endpoint access (detects recon)
    prisma.auditLog.count({
      where: {
        action: { startsWith: "debug_" },
        createdAt: { gte: last24h }
      }
    }),
    // IDOR attempts (receipt/customer lookups by non-owners)
    prisma.auditLog.count({
      where: {
        action: { in: ["receipt_viewed", "customer_bulk_lookup"] },
        createdAt: { gte: last24h }
      }
    })
  ]);

  // Aggregate login attempts into hourly buckets
  const hourlyBuckets = {};
  for (const event of loginAttemptsByHour) {
    const hour = new Date(event.createdAt);
    hour.setMinutes(0, 0, 0);
    const key = hour.toISOString();
    if (!hourlyBuckets[key]) {
      hourlyBuckets[key] = { hour: key, attempts: 0, failures: 0, successes: 0 };
    }
    hourlyBuckets[key].attempts++;
    if (event.action === "auth_login_failed") {
      hourlyBuckets[key].failures++;
    }
    if (event.action === "auth_login_success") {
      hourlyBuckets[key].successes++;
    }
  }

  // Calculate threat level
  let threatLevel = "LOW";
  if (failedLogins1h > 20 || lockouts24h > 3 || debugEndpointAccess24h > 0) {
    threatLevel = "HIGH";
  } else if (failedLogins1h > 5 || failedLogins24h > 30 || suspiciousEvents24h > 0) {
    threatLevel = "MEDIUM";
  }
  if (failedLogins1h > 50 || lockouts24h > 10) {
    threatLevel = "CRITICAL";
  }

  return res.json({
    dashboard: {
      threatLevel,
      timestamp: new Date().toISOString(),
      summary: {
        failedLogins1h,
        failedLogins24h,
        lockouts24h,
        suspiciousEvents24h,
        totalEvents24h,
        debugEndpointAccess24h,
        idorAttempts24h
      },
      recentCriticalEvents: recentCritical,
      topAttackerIPs: topAttackerIPs.map((row) => ({
        ip: row.ip,
        failedAttempts: row._count._all
      })),
      eventsByCategory: eventsByCategory.map((row) => ({
        category: row.category,
        count: row._count._all
      })),
      eventsBySeverity: eventsBySeverity.map((row) => ({
        severity: row.severity,
        count: row._count._all
      })),
      loginTimeline: Object.values(hourlyBuckets)
    }
  });
});

//polling endpoint for real-time monitoring
router.get("/events/live", requirePermission(permissions.AUDIT_READ), async (req, res) => {
  const sinceParam = req.query.since;
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 5 * 60 * 1000);

  const events = await prisma.auditLog.findMany({
    where: {
      createdAt: { gt: since }
    },
    include: {
      actor: { select: { id: true, username: true, role: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });

  return res.json({
    events,
    since: since.toISOString(),
    timestamp: new Date().toISOString()
  });
});

// IP investigation; look up all activity from a specific IP
router.get("/investigate/ip/:ip", requirePermission(permissions.AUDIT_READ), async (req, res) => {
  const ip = req.params.ip;
  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [events, actionBreakdown, userAgents] = await Promise.all([
    prisma.auditLog.findMany({
      where: { ip, createdAt: { gte: last7d } },
      include: {
        actor: { select: { id: true, username: true, role: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { ip, createdAt: { gte: last7d } },
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } }
    }),
    prisma.auditLog.findMany({
      where: { ip, createdAt: { gte: last7d }, userAgent: { not: null } },
      select: { userAgent: true },
      distinct: ["userAgent"]
    })
  ]);

  return res.json({
    ip,
    investigation: {
      totalEvents: events.length,
      events,
      actionBreakdown: actionBreakdown.map((row) => ({
        action: row.action,
        count: row._count._all
      })),
      userAgents: userAgents.map((row) => row.userAgent)
    }
  });
});

// User investigation; look up all activity for a specific user
router.get("/investigate/user/:userId", requirePermission(permissions.AUDIT_READ), async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user ID." });
  }

  const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [user, events, actionBreakdown, ipAddresses] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        active: true,
        failedLogins: true,
        lockedUntil: true,
        lastFailedLoginAt: true,
        createdAt: true
      }
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId, createdAt: { gte: last7d } },
      orderBy: { createdAt: "desc" },
      take: 200
    }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: { actorId: userId, createdAt: { gte: last7d } },
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } }
    }),
    prisma.auditLog.findMany({
      where: { actorId: userId, createdAt: { gte: last7d }, ip: { not: null } },
      select: { ip: true },
      distinct: ["ip"]
    })
  ]);

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.json({
    user,
    investigation: {
      totalEvents: events.length,
      events,
      actionBreakdown: actionBreakdown.map((row) => ({
        action: row.action,
        count: row._count._all
      })),
      ipAddresses: ipAddresses.map((row) => row.ip)
    }
  });
});

//incident response
router.post("/respond/lock-user", requirePermission(permissions.USER_MANAGE), async (req, res) => {
  const { userId, reason, durationMinutes } = req.body;

  if (!userId || !Number.isInteger(userId)) {
    return res.status(400).json({ message: "Valid userId required." });
  }

  const lockUntil = new Date(Date.now() + (durationMinutes || 60) * 60 * 1000);

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      lockedUntil: lockUntil,
      active: false
    },
    select: { id: true, username: true, role: true, active: true, lockedUntil: true }
  });

  await emitSecurityEvent("incident_response_user_locked", {
    targetUserId: userId,
    targetUsername: user.username,
    reason: reason || "Manual lock by security team",
    lockedUntil: lockUntil.toISOString(),
    responderId: req.user.id
  }, req);

  return res.json({ message: "User locked.", user });
});

router.post("/respond/unlock-user", requirePermission(permissions.USER_MANAGE), async (req, res) => {
  const { userId, reason } = req.body;

  if (!userId || !Number.isInteger(userId)) {
    return res.status(400).json({ message: "Valid userId required." });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      lockedUntil: null,
      failedLogins: 0,
      active: true
    },
    select: { id: true, username: true, role: true, active: true, lockedUntil: true }
  });

  await emitSecurityEvent("incident_response_user_unlocked", {
    targetUserId: userId,
    targetUsername: user.username,
    reason: reason || "Manual unlock by security team",
    responderId: req.user.id
  }, req);

  return res.json({ message: "User unlocked.", user });
});

//get alert rules and status
router.get("/alerts", requirePermission(permissions.AUDIT_READ), async (req, res) => {
  const last1h = new Date(Date.now() - 60 * 60 * 1000);
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    failedLogins1h,
    debugAccess1h,
    idorAccess1h,
    sqlErrorEvents,
    lockedAccounts
  ] = await Promise.all([
    prisma.auditLog.count({
      where: { action: "auth_login_failed", createdAt: { gte: last1h } }
    }),
    prisma.auditLog.count({
      where: { action: { startsWith: "debug_" }, createdAt: { gte: last1h } }
    }),
    prisma.auditLog.count({
      where: {
        action: { in: ["receipt_viewed", "customer_bulk_lookup"] },
        createdAt: { gte: last1h }
      }
    }),
    prisma.auditLog.count({
      where: { action: "report_product_search", createdAt: { gte: last1h } }
    }),
    prisma.user.count({
      where: { lockedUntil: { not: null, gte: new Date() } }
    })
  ]);

  const alerts = [];

  if (failedLogins1h > 10) {
    alerts.push({
      id: "BRUTE_FORCE",
      severity: "critical",
      title: "Possible Brute Force Attack",
      description: `${failedLogins1h} failed login attempts in the last hour.`,
      metric: failedLogins1h,
      threshold: 10
    });
  } else if (failedLogins1h > 3) {
    alerts.push({
      id: "ELEVATED_LOGIN_FAILURES",
      severity: "warning",
      title: "Elevated Login Failures",
      description: `${failedLogins1h} failed login attempts in the last hour.`,
      metric: failedLogins1h,
      threshold: 3
    });
  }

  if (debugAccess1h > 0) {
    alerts.push({
      id: "RECON_DEBUG_ENDPOINT",
      severity: "critical",
      title: "Debug Endpoint Reconnaissance",
      description: `Debug/info endpoints accessed ${debugAccess1h} times in the last hour. Possible attacker recon.`,
      metric: debugAccess1h,
      threshold: 1
    });
  }

  if (idorAccess1h > 5) {
    alerts.push({
      id: "IDOR_ENUMERATION",
      severity: "warning",
      title: "Possible IDOR Enumeration",
      description: `${idorAccess1h} receipt/customer lookups in the last hour. Possible data scraping.`,
      metric: idorAccess1h,
      threshold: 5
    });
  }

  if (sqlErrorEvents > 3) {
    alerts.push({
      id: "SQL_INJECTION_ATTEMPT",
      severity: "critical",
      title: "Possible SQL Injection Attempt",
      description: `${sqlErrorEvents} report search queries in the last hour. Check for injection payloads.`,
      metric: sqlErrorEvents,
      threshold: 3
    });
  }

  if (lockedAccounts > 0) {
    alerts.push({
      id: "ACCOUNTS_LOCKED",
      severity: "info",
      title: "Locked Accounts",
      description: `${lockedAccounts} user accounts are currently locked out.`,
      metric: lockedAccounts,
      threshold: 0
    });
  }

  return res.json({
    alerts,
    generatedAt: new Date().toISOString()
  });
});

export default router;

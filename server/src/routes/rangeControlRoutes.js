import { Router } from "express";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { requireAuth } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { emitSecurityEvent } from "../security/events.js";

const router = Router();

// ---------------------------------------------------------------------------
// Range control panel: lets a SUPERADMIN (TORCHADMIN) toggle cyber-range
// features on/off at runtime without restarting the server. These toggles
// are persisted in the RangeSetting table.
//
// Known settings and their defaults:
//   soc_dashboard_enabled        "true"  - show /admin/security to admins
//   audit_log_visible            "true"  - show /admin/audit-logs to admins
//   debug_endpoints_enabled      "true"  - /api/debug/* responds (range vuln)
//   red_team_simulator_visible   "true"  - hint that simulate-attacks is live
// ---------------------------------------------------------------------------

const DEFAULTS = {
  soc_dashboard_enabled: "true",
  audit_log_visible: "true",
  debug_endpoints_enabled: "true",
  red_team_simulator_visible: "true"
};

export async function getSetting(key) {
  const row = await prisma.rangeSetting.findUnique({ where: { key } });
  if (row) return row.value;
  return DEFAULTS[key] ?? null;
}

export async function getAllSettings() {
  const rows = await prisma.rangeSetting.findMany();
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// any authenticated user can read the public-facing toggle state
// so we can hide/show nav links client-side without leaking superadmin access
router.get("/settings/public", requireAuth, async (_req, res) => {
  const all = await getAllSettings();
  res.json({
    settings: {
      soc_dashboard_enabled: all.soc_dashboard_enabled,
      audit_log_visible: all.audit_log_visible
    }
  });
});

// full settings list - SUPERADMIN only
router.get("/settings", requirePermission(permissions.RANGE_ADMIN), async (_req, res) => {
  res.json({ settings: await getAllSettings() });
});

router.put("/settings", requirePermission(permissions.RANGE_ADMIN), async (req, res) => {
  const body = req.body || {};
  if (typeof body !== "object") {
    return res.status(400).json({ message: "body must be { key: value } map" });
  }

  const known = Object.keys(DEFAULTS);
  const updates = [];
  for (const [k, v] of Object.entries(body)) {
    if (!known.includes(k)) continue;
    const value = String(v);
    updates.push(
      prisma.rangeSetting.upsert({
        where: { key: k },
        update: { value, updatedBy: req.user.id },
        create: { key: k, value, updatedBy: req.user.id }
      })
    );
  }
  await Promise.all(updates);

  await emitSecurityEvent("range_settings_updated", {
    keys: Object.keys(body),
    actorId: req.user.id
  }, req);

  res.json({ settings: await getAllSettings() });
});

// Overview of range hosts/accounts - handy for the jump box admin view
router.get("/overview", requirePermission(permissions.RANGE_ADMIN), async (_req, res) => {
  const [userCount, cashierCount, adminCount, locked, recentFailures] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "CASHIER" } }),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.count({ where: { lockedUntil: { not: null, gte: new Date() } } }),
    prisma.auditLog.count({
      where: {
        action: "auth_login_failed",
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }
      }
    })
  ]);

  res.json({
    overview: {
      userCount,
      cashierCount,
      adminCount,
      lockedAccounts: locked,
      recentFailedLogins1h: recentFailures,
      generatedAt: new Date().toISOString()
    }
  });
});

export default router;

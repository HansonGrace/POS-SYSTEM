import { Router } from "express";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { emitSecurityEvent } from "../security/events.js";

const router = Router();

// -----------------------------------------------------------------------
// VULNERABILITY: Information Disclosure via debug endpoint
// -----------------------------------------------------------------------
// This endpoint is "hidden" but not protected. It leaks:
//   - Environment variables (may include secrets)
//   - OS information (hostname, platform, architecture, uptime)
//   - Node.js version and process info
//   - Database connection details
//   - Internal configuration
//
// No authentication required! Anyone who discovers this endpoint gets
// full system intelligence.
//
// Discovery vectors:
//   - Directory brute-forcing (e.g., dirbuster, gobuster)
//   - Guessing common debug paths
//   - Source code review if accessible
// -----------------------------------------------------------------------
router.get("/info", async (req, res) => {
  // Emit an audit event so blue team can detect access
  await emitSecurityEvent("debug_endpoint_accessed", {
    path: "/api/debug/info",
    note: "Unauthenticated access to debug info endpoint"
  }, req);

  return res.json({
    application: {
      name: "RangePOS",
      version: config.appVersion,
      environment: config.nodeEnv,
      labMode: config.labMode,
      labProfile: config.labProfile
    },
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      uptime: os.uptime(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpus: os.cpus().length,
      networkInterfaces: Object.keys(os.networkInterfaces())
    },
    process: {
      nodeVersion: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cwd: process.cwd(),
      execPath: process.execPath
    },
    database: {
      provider: config.databaseProvider,
      url: config.databaseUrl
    },
    security: {
      csrfEnabled: config.csrfEnabled,
      rateLimitEnabled: config.rateLimitEnabled,
      lockoutEnabled: config.lockoutEnabled,
      lockoutThreshold: config.lockoutThreshold,
      weakPasswordsAllowed: config.weakPasswordsAllowed,
      sessionName: config.sessionName,
      // Intentionally leaking this - red team gold
      sessionSecret: config.sessionSecret.substring(0, 8) + "..."
    },
    siem: {
      mode: config.siemMode,
      syslogHost: config.syslogHost || null,
      httpUrl: config.siemHttpUrl || null
    }
  });
});

// -----------------------------------------------------------------------
// VULNERABILITY: Sensitive config dump (requires auth but no role check)
// -----------------------------------------------------------------------
// Any authenticated user (including cashiers) can dump full config.
// This should be admin-only but the permission check is missing.
// -----------------------------------------------------------------------
router.get("/config", requireAuth, async (req, res) => {
  await emitSecurityEvent("debug_config_accessed", {
    actorId: req.user.id,
    actorRole: req.user.role
  }, req);

  return res.json({
    config: {
      ...config,
      // Leak the full session secret to authenticated users
      sessionSecret: config.sessionSecret
    }
  });
});

// -----------------------------------------------------------------------
// VULNERABILITY: Directory Traversal in log/export file access
// -----------------------------------------------------------------------
// This endpoint is meant to serve export files but doesn't sanitize
// the filename parameter, allowing path traversal.
//
// Example exploits:
//   GET /api/debug/export/../../../../etc/passwd
//   GET /api/debug/export/..%2F..%2F..%2F..%2Fetc%2Fpasswd
//   GET /api/debug/export/../.env
// -----------------------------------------------------------------------
router.get("/export/:filename", requireAuth, async (req, res) => {
  const filename = req.params.filename;
  // VULNERABLE: No path sanitization - allows directory traversal
  const exportDir = path.resolve(process.cwd(), "exports");
  const filePath = path.join(exportDir, filename);

  await emitSecurityEvent("debug_export_accessed", {
    filename,
    resolvedPath: filePath,
    actorId: req.user.id
  }, req);

  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        message: "Export file not found.",
        // VULNERABILITY: Leaks the resolved file path
        path: filePath
      });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Content-Type", "text/plain");
    return res.send(content);
  } catch (error) {
    return res.status(500).json({
      message: "Failed to read export file.",
      error: error.message,
      path: filePath
    });
  }
});

// -----------------------------------------------------------------------
// VULNERABILITY: User enumeration endpoint
// -----------------------------------------------------------------------
// Returns user details including password hashes and internal fields.
// Protected by auth but not by role - any cashier can see all users.
// -----------------------------------------------------------------------
router.get("/users", requireAuth, async (req, res) => {
  await emitSecurityEvent("debug_users_accessed", {
    actorId: req.user.id,
    actorRole: req.user.role
  }, req);

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      role: true,
      active: true,
      // VULNERABLE: Exposing password hashes
      passwordHash: true,
      failedLogins: true,
      lockedUntil: true,
      lastFailedLoginAt: true,
      createdAt: true
    }
  });

  return res.json({ users });
});

export default router;

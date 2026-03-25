import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { emitSecurityEvent } from "../security/events.js";
import { csrfTokenHandler } from "../security/csrf.js";
import { incrementMetric } from "../observability/metrics.js";
import { logger } from "../logging/logger.js";

const router = Router();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false)
});

const LOGIN_FAILURE_MESSAGE = "Invalid username or password.";
const LOGIN_FAILURE_DELAY_MS = 120;
const DUMMY_PASSWORD_HASH = "$2a$10$0YOPrg403kJHVOX7tBafzucc4Mu6jbb.XOGbjbq58O8yO9yk7j6gu";

function buildLoginLimiter() {
  if (!config.rateLimitEnabled) {
    return (_req, _res, next) => next();
  }

  return rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${req.ip}:${String(req.body?.username || "")
        .trim()
        .toLowerCase()}`,
    handler: async (req, res) => {
      await emitSecurityEvent(
        "suspicious_rate_limit_hit",
        {
          path: req.originalUrl || req.url,
          username: String(req.body?.username || "").trim().toLowerCase()
        },
        req
      );

      return res.status(429).json({ message: "Too many login attempts. Try again later." });
    }
  });
}

const loginLimiter = buildLoginLimiter();

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function emitLoginFailure(startTime, req, user, reason, extra = {}) {
  const elapsedMs = Date.now() - startTime;
  const delayMs = Math.max(0, LOGIN_FAILURE_DELAY_MS - elapsedMs);
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (user) {
    await emitSecurityEvent(
      "auth_login_failed",
      { username: user, reason, ...extra },
      req
    );
  } else {
    await emitSecurityEvent("auth_login_failed", { reason, ...extra }, req);
  }

  return LOGIN_FAILURE_MESSAGE;
}

router.get("/csrf", csrfTokenHandler);

router.post("/login", loginLimiter, async (req, res) => {
  if (config.observabilityMetricsEnabled) {
    incrementMetric("login_attempts_total", { route: "/api/auth/login" });
  }

  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    if (config.observabilityMetricsEnabled) {
      incrementMetric("login_failures_total", { reason: "invalid_payload" });
    }
    logger.warn({ eventType: "auth_login_validation_failed", requestId: req.requestId });
    return res.status(400).json({ message: "Invalid login payload." });
  }

  const username = parsed.data.username.toLowerCase();
  const { password, rememberMe } = parsed.data;
  const now = new Date();
  const requestStart = Date.now();

  await emitSecurityEvent("auth_login_attempt", { username }, req);

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("login_failures_total", { reason: "invalid_user" });
    }
    const message = await emitLoginFailure(requestStart, req, username, "invalid_user");
    return res.status(401).json({ message });
  }

  if (config.lockoutEnabled && user.lockedUntil && user.lockedUntil > now) {
    await bcrypt.compare(password, user.passwordHash);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("login_failures_total", { reason: "account_locked" });
    }
    const message = await emitLoginFailure(
      requestStart,
      req,
      user.username,
      "account_locked",
      { lockedUntil: user.lockedUntil }
    );
    return res.status(401).json({ message });
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    if (config.observabilityMetricsEnabled) {
      incrementMetric("login_failures_total", { reason: "bad_password" });
    }

    const nextFailed = user.failedLogins + 1;
    const updateData = {
      failedLogins: { increment: 1 },
      lastFailedLoginAt: now
    };

    if (config.lockoutEnabled && nextFailed >= config.lockoutThreshold) {
      const lockUntil = new Date(now.getTime() + config.lockoutMinutes * 60 * 1000);
      updateData.lockedUntil = lockUntil;
      await emitSecurityEvent(
        "auth_account_locked",
        { userId: user.id, username: user.username, lockedUntil: lockUntil },
        req
      );
    } else if (!config.lockoutEnabled) {
      await emitSecurityEvent(
        "lockout_disabled",
        { userId: user.id, username: user.username, failedLogins: nextFailed },
        req
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData
    });

    const message = await emitLoginFailure(requestStart, req, user.username, "bad_password", {
      failedLogins: nextFailed
    });

    return res.status(401).json({ message });
  }

  try {
    await regenerateSession(req);
  } catch {
    return res.status(500).json({ message: "Failed to create session." });
  }

  req.session.authUser = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  if (rememberMe) {
    req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 7;
  } else {
    req.session.cookie.expires = false;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastFailedLoginAt: null }
  });

  await emitSecurityEvent("auth_login_success", { userId: user.id, rememberMe }, req);
  if (config.observabilityMetricsEnabled) {
    incrementMetric("login_success_total", { role: user.role });
  }

  return res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

router.post("/logout", requireAuth, async (req, res) => {
  const actorId = req.user.id;

  req.session.destroy(async (error) => {
    if (error) {
      return res.status(500).json({ message: "Failed to log out." });
    }

    await emitSecurityEvent("auth_logout", { userId: actorId }, req);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("logout_total", { role: req.user.role });
    }

    res.clearCookie(config.sessionName);
    return res.json({ message: "Logged out." });
  });
});

router.get("/me", (req, res) => {
  const authUser = req.session?.authUser;
  if (!authUser) {
    return res.status(401).json({ message: "Not authenticated." });
  }

  return res.json({ user: authUser });
});

export default router;

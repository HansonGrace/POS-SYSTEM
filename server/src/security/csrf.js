import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import { emitSecurityEvent } from "./events.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function ensureCsrfToken(req) {
  if (!req.session) {
    return null;
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(24).toString("hex");
  }

  return req.session.csrfToken;
}

export function csrfTokenHandler(req, res) {
  const csrfToken = ensureCsrfToken(req);
  return res.json({
    csrfToken,
    enabled: config.csrfEnabled
  });
}

export async function csrfProtection(req, res, next) {
  if (!config.csrfEnabled || SAFE_METHODS.has(req.method)) {
    return next();
  }

  const expectedToken = ensureCsrfToken(req);
  const providedToken = req.get("x-csrf-token");

  if (!expectedToken || !providedToken || expectedToken !== providedToken) {
    await emitSecurityEvent(
      "suspicious_csrf_failure",
      { reason: "csrf_validation_failed", path: req.originalUrl || req.url },
      req
    );
    return res.status(403).json({ message: "Invalid CSRF token." });
  }

  return next();
}

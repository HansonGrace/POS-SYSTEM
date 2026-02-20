import { randomUUID } from "node:crypto";
import { logger } from "../logging/logger.js";

export function assignRequestContext(req, res, next) {
  const requestIdHeader = req.get("x-request-id");
  const requestId = requestIdHeader && requestIdHeader.trim() ? requestIdHeader.trim() : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  req.requestStart = process.hrtime.bigint();
  next();
}

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedNs = process.hrtime.bigint() - startedAt;
    const latencyMs = Number(elapsedNs) / 1_000_000;

    logger.info({
      type: "request",
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      latencyMs: Number(latencyMs.toFixed(2)),
      ip: req.ip,
      userAgent: req.get("user-agent") || "unknown",
      userId: req.user?.id ?? req.session?.authUser?.id ?? null,
      role: req.user?.role ?? req.session?.authUser?.role ?? null
    });
  });

  next();
}

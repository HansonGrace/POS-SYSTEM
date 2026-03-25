import { randomUUID } from "node:crypto";
import { logger } from "../logging/logger.js";
import { runWithRequestContext, setRequestContextValue } from "../observability/context.js";
import { incrementMetric, observeMetricDuration } from "../observability/metrics.js";
import { config } from "../config.js";

export function assignRequestContext(req, res, next) {
  const requestIdHeader = req.get("x-request-id");
  const correlationIdHeader = req.get("x-correlation-id");
  const requestId = requestIdHeader && requestIdHeader.trim() ? requestIdHeader.trim() : randomUUID();
  const correlationId =
    correlationIdHeader && correlationIdHeader.trim() ? correlationIdHeader.trim() : requestId;

  req.requestId = requestId;
  req.correlationId = correlationId;
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Correlation-Id", correlationId);
  req.requestStart = process.hrtime.bigint();

  runWithRequestContext(
    {
      requestId,
      correlationId,
      requestMethod: req.method,
      requestPath: req.originalUrl || req.url,
      actorId: null,
      actorRole: null
    },
    next
  );
}

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedNs = process.hrtime.bigint() - startedAt;
    const latencyMs = Number(elapsedNs) / 1_000_000;
    const normalizedPath = req.route?.path || req.path || req.originalUrl || req.url;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;

    if (config.observabilityMetricsEnabled) {
      incrementMetric("api_request_count", {
        method: req.method,
        path: normalizedPath,
        statusClass
      });
      observeMetricDuration("api_request_latency_ms", latencyMs, {
        method: req.method,
        path: normalizedPath
      });
    }

    if (config.observabilityMetricsEnabled && res.statusCode >= 400) {
      incrementMetric("api_error_count", {
        method: req.method,
        path: normalizedPath,
        statusClass
      });
    }

    logger.info({
      eventType: "http_request_complete",
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      path: req.originalUrl || req.url,
      route: normalizedPath,
      status: res.statusCode,
      statusClass,
      latencyMs: Number(latencyMs.toFixed(2)),
      ip: req.ip,
      userAgent: req.get("user-agent") || "unknown",
      userId: req.user?.id ?? req.session?.authUser?.id ?? null,
      role: req.user?.role ?? req.session?.authUser?.role ?? null
    });
  });

  const actor = req.user || req.session?.authUser;
  if (actor) {
    setRequestContextValue("actorId", actor.id);
    setRequestContextValue("actorRole", actor.role);
  }

  next();
}

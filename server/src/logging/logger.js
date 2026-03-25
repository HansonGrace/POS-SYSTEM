import pino from "pino";
import { config } from "../config.js";
import { getRequestContext } from "../observability/context.js";
import { redactSensitiveFields } from "../security/redaction.js";

export const logger = pino({
  level: config.logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: "rangepos-api",
    environment: config.nodeEnv
  },
  mixin() {
    const context = getRequestContext();
    if (!context) {
      return {};
    }

    return {
      requestId: context.requestId,
      correlationId: context.correlationId || context.requestId,
      actorId: context.actorId ?? null,
      actorRole: context.actorRole ?? null
    };
  }
});

export function safeLog(level, payload, message) {
  const sanitized = redactSensitiveFields(payload || {});
  logger[level](sanitized, message);
}

export function logStructuredError(error, context = {}, message = "Unhandled application error") {
  logger.error(
    {
      err: error,
      context: redactSensitiveFields(context),
      eventType: "application_error"
    },
    message
  );
}

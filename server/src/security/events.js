import dgram from "node:dgram";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";
import { classifyEvent } from "../observability/events.js";
import { incrementMetric } from "../observability/metrics.js";
import { redactSensitiveFields } from "./redaction.js";

function sendSyslog(payload) {
  if (!config.syslogHost) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const message = Buffer.from(
      `<134>1 ${new Date().toISOString()} rangepos security - - ${JSON.stringify(payload)}`
    );

    socket.send(message, config.syslogPort, config.syslogHost, (error) => {
      socket.close();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function sendHttpEvent(payload) {
  if (!config.siemHttpUrl) {
    return;
  }

  const headers = {
    "content-type": "application/json"
  };

  if (config.siemHttpApiKey) {
    headers.authorization = `Bearer ${config.siemHttpApiKey}`;
  }

  await fetch(config.siemHttpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
}

async function forwardToSiem(payload) {
  if (config.siemMode === "off" || !config.observabilityEnabled) {
    return;
  }

  try {
    if (config.siemMode === "syslog") {
      await sendSyslog(payload);
      return;
    }

    if (config.siemMode === "http") {
      await sendHttpEvent(payload);
    }
  } catch (error) {
    logger.warn({ err: error, eventType: "siem_forward_failed" });
  }
}

export async function emitSecurityEvent(type, payload = {}, req = null) {
  if (!config.observabilityEnabled) {
    return;
  }

  const actorId = req?.user?.id ?? req?.session?.authUser?.id ?? null;
  const requestId = req?.requestId ?? null;
  const correlationId = req?.correlationId ?? requestId;
  const ip = req?.ip ?? null;
  const userAgent = req?.get?.("user-agent") ?? null;
  const classification = classifyEvent(type);
  const safePayload = redactSensitiveFields(payload);

  const event = {
    type,
    severity: classification.severity,
    category: classification.category,
    alertClass: classification.alertClass,
    actorId,
    requestId,
    correlationId,
    ip,
    userAgent,
    payload: safePayload,
    timestamp: new Date().toISOString()
  };

  logger.info({ eventType: "audit_event", event });
  if (config.observabilityMetricsEnabled) {
    incrementMetric("audit_event_count", {
      action: type,
      category: classification.category,
      severity: classification.severity
    });
  }

  try {
    if (config.observabilityAuditEnabled) {
      await prisma.auditLog.create({
        data: {
          actorId,
          action: type,
          metadata: safePayload,
          requestId,
          ip,
          userAgent,
          severity: classification.severity,
          category: classification.category
        }
      });
    }
  } catch (error) {
    logger.error({ err: error, eventType: "audit_log_write_failed", action: type });
  }

  void forwardToSiem(event);
}

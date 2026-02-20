import dgram from "node:dgram";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";

const severityByEventType = {
  auth_login_success: "info",
  auth_login_failed: "warning",
  auth_account_locked: "warning",
  auth_logout: "info",
  lockout_disabled: "warning",
  data_customers_list_access: "info",
  data_customer_detail_access: "info",
  data_customer_search: "info",
  data_customer_token_access: "warning",
  product_created: "info",
  product_updated: "info",
  product_deactivated: "warning",
  customer_created: "info",
  customer_updated: "info",
  order_created: "info",
  order_voided: "warning",
  payment_method_added: "info",
  admin_user_created: "info",
  admin_user_updated: "info",
  admin_user_deleted: "warning",
  suspicious_rate_limit_hit: "warning",
  suspicious_csrf_failure: "warning",
  suspicious_inventory_negative_attempt: "warning"
};

const categoryByEventType = {
  auth_login_success: "auth",
  auth_login_failed: "auth",
  auth_account_locked: "auth",
  auth_logout: "auth",
  lockout_disabled: "auth",
  data_customers_list_access: "data",
  data_customer_detail_access: "data",
  data_customer_search: "data",
  data_customer_token_access: "data",
  product_created: "inventory",
  product_updated: "inventory",
  product_deactivated: "inventory",
  customer_created: "data",
  customer_updated: "data",
  order_created: "transaction",
  order_voided: "transaction",
  payment_method_added: "transaction",
  admin_user_created: "admin",
  admin_user_updated: "admin",
  admin_user_deleted: "admin",
  suspicious_rate_limit_hit: "threat",
  suspicious_csrf_failure: "threat",
  suspicious_inventory_negative_attempt: "threat"
};

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
  if (config.siemMode === "off") {
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
    logger.warn({ err: error, type: "siem_forward_failed" });
  }
}

export async function emitSecurityEvent(type, payload = {}, req = null) {
  const actorId = req?.user?.id ?? req?.session?.authUser?.id ?? null;
  const requestId = req?.requestId ?? null;
  const ip = req?.ip ?? null;
  const userAgent = req?.get?.("user-agent") ?? null;
  const severity = severityByEventType[type] || "info";
  const category = categoryByEventType[type] || "app";

  const event = {
    type,
    severity,
    category,
    actorId,
    requestId,
    ip,
    userAgent,
    payload,
    time: new Date().toISOString()
  };

  logger.info({ type: "security_event", event });

  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action: type,
        metadata: payload,
        requestId,
        ip,
        userAgent,
        severity,
        category
      }
    });
  } catch (error) {
    logger.error({ err: error, type: "audit_log_write_failed", eventType: type });
  }

  forwardToSiem(event);
}

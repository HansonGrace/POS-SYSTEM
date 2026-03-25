import { config } from "../../config/index.js";
import { logger as defaultLogger } from "../../logging/logger.js";
import { prisma as defaultDb } from "../../db.js";

export function createHealthHandler({
  db = defaultDb,
  appLogger = defaultLogger,
  appVersion = config.appVersion
} = {}) {
  return async (_req, res) => {
    let dbConnected = false;
    try {
      await db.$queryRaw`SELECT 1`;
      dbConnected = true;
    } catch (error) {
      appLogger.warn({ err: error, eventType: "health_db_check_failed" });
    }

    return res.json({
      status: dbConnected ? "ok" : "degraded",
      time: new Date().toISOString(),
      version: appVersion,
      dbConnected
    });
  };
}

export const healthHandler = createHealthHandler();

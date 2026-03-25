import { createApp } from "./app.js";
import { config, printStartupBanner } from "./config.js";
import { logger } from "./logging/logger.js";
import { incrementMetric } from "./observability/metrics.js";

const app = createApp();

printStartupBanner();
logger.info(
  {
    eventType: "config_loaded",
    env: config.nodeEnv,
    appEnvLabel: config.appEnvLabel,
    labMode: config.labMode,
    logLevel: config.logLevel,
    observability: {
      enabled: config.observabilityEnabled,
      metricsEnabled: config.observabilityMetricsEnabled,
      auditEnabled: config.observabilityAuditEnabled
    }
  },
  "Configuration loaded"
);
for (const warning of config.startupWarnings) {
  logger.warn({ eventType: "config_load_warning", warning });
}

const server = app.listen(config.port, config.host, () => {
  if (config.observabilityMetricsEnabled) {
    incrementMetric("server_start_total", { env: config.nodeEnv });
  }
  logger.info({ eventType: "startup", url: `http://${config.host}:${config.port}` }, "POS server listening");
});

function shutdown(signal) {
  logger.info({ eventType: "shutdown", signal }, "Shutting down server");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

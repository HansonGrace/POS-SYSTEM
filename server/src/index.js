import { createApp } from "./app.js";
import { config, printStartupBanner } from "./config.js";
import { logger } from "./logging/logger.js";

const app = createApp();

printStartupBanner();
for (const warning of config.startupWarnings) {
  logger.warn({ type: "startup_warning", warning });
}

const server = app.listen(config.port, config.host, () => {
  logger.info({ type: "startup", url: `http://${config.host}:${config.port}` }, "POS server listening");
});

function shutdown(signal) {
  logger.info({ type: "shutdown", signal }, "Shutting down server");
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

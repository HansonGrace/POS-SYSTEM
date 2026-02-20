import cors from "cors";
import express from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { assignRequestContext, requestLogger } from "./middleware/requestContext.js";
import { csrfProtection } from "./security/csrf.js";
import { logger } from "./logging/logger.js";
import { prisma } from "./db.js";
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import configRoutes from "./routes/configRoutes.js";

const SQLiteStore = connectSqlite3(session);

export function createApp() {
  const app = express();
  const sessionsDir = path.resolve(process.cwd(), "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });

  app.set("trust proxy", config.trustProxy ? 1 : 0);
  app.use(assignRequestContext);
  app.use(requestLogger);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: true
    })
  );

  app.use(express.json({ limit: "1mb" }));

  app.use(
    session({
      name: config.sessionName,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new SQLiteStore({
        db: "sessions.db",
        dir: sessionsDir
      }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
        maxAge: 1000 * 60 * 60 * 8
      }
    })
  );

  app.use(csrfProtection);

  app.get("/api/health", async (_req, res) => {
    let dbConnected = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbConnected = true;
    } catch (error) {
      logger.warn({ err: error, type: "health_db_check_failed" });
    }

    return res.json({
      status: dbConnected ? "ok" : "degraded",
      time: new Date().toISOString(),
      version: config.appVersion,
      dbConnected
    });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/config", configRoutes);

  app.use((req, res) => {
    res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
  });

  app.use((error, _req, res, _next) => {
    logger.error({ err: error, type: "unhandled_error" });
    res.status(500).json({ message: "Internal server error." });
  });

  return app;
}

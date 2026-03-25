import cors from "cors";
import express from "express";
import session from "express-session";
import connectSqlite3 from "connect-sqlite3";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { assignRequestContext, requestLogger } from "./middleware/requestContext.js";
import { csrfProtection } from "./security/csrf.js";
import { logStructuredError, logger } from "./logging/logger.js";
import { prisma } from "./db.js";
import { mountApi } from "./presentation/http/api.js";

const SQLiteStore = connectSqlite3(session);

export function createApp() {
  const app = express();
  const sessionsDir = path.resolve(process.cwd(), "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });

  app.set("trust proxy", config.trustProxy ? 1 : 0);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "base-uri": ["'none'"],
          "frame-ancestors": ["'none'"],
          "form-action": ["'self'"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"]
        }
      },
      frameguard: { action: "deny" },
      noSniff: true,
      referrerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: true,
      xssFilter: true,
      hsts: config.cookieSecure || config.trustProxy
        ? {
            maxAge: 15552000,
            includeSubDomains: true
          }
        : false
    })
  );
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

  mountApi(app, { db: prisma, logger, config });

  app.use((req, res) => {
    res.status(404).json({ message: `Route not found: ${req.method} ${req.path}` });
  });

  app.use((error, req, res, _next) => {
    logStructuredError(error, { path: req.path, method: req.method, requestId: req.requestId });
    res.status(500).json({ message: "Internal server error.", requestId: req.requestId || null });
  });

  return app;
}

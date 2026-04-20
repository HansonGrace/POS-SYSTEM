import { Router } from "express";
import authRoutes from "../../routes/authRoutes.js";
import productRoutes from "../../routes/productRoutes.js";
import orderRoutes from "../../routes/orderRoutes.js";
import transactionRoutes from "../../routes/transactionRoutes.js";
import userRoutes from "../../routes/userRoutes.js";
import customerRoutes from "../../routes/customerRoutes.js";
import adminRoutes from "../../routes/adminRoutes.js";
import configRoutes from "../../routes/configRoutes.js";
import registerSessionRoutes from "../../routes/registerSessionRoutes.js";
import reportRoutes from "../../routes/reportRoutes.js";
import debugRoutes from "../../routes/debugRoutes.js";
import receiptRoutes from "../../routes/receiptRoutes.js";
import securityRoutes from "../../routes/securityRoutes.js";
import rangeControlRoutes from "../../routes/rangeControlRoutes.js";
import { createHealthHandler } from "./health.js";

export function createApiRouter({ db, logger, config: configOption, appConfig } = {}) {
  const effectiveConfig = configOption ?? appConfig;
  const api = Router();

  api.get(
    "/health",
    createHealthHandler({ db, appLogger: logger, appVersion: effectiveConfig?.appVersion })
  );

  api.use("/auth", authRoutes);
  api.use("/products", productRoutes);
  api.use("/orders", orderRoutes);
  api.use("/transactions", transactionRoutes);
  api.use("/users", userRoutes);
  api.use("/customers", customerRoutes);
  api.use("/admin", adminRoutes);
  api.use("/config", configRoutes);
  api.use("/register-sessions", registerSessionRoutes);
  api.use("/reports", reportRoutes);
  api.use("/debug", debugRoutes);
  api.use("/receipts", receiptRoutes);
  api.use("/security", securityRoutes);
  api.use("/range", rangeControlRoutes);

  return api;
}

export function mountApi(app, dependencies = {}) {
  const apiRouter = createApiRouter(dependencies);
  app.use("/api", apiRouter);
  return apiRouter;
}

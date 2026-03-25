import { Router } from "express";
import { config } from "../config.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";

const router = Router();

router.get("/", requirePermission(permissions.CONFIG_READ), (_req, res) => {
  return res.json({
    taxRate: config.taxRate,
    voidWindowMinutes: config.voidWindowMinutes,
    csrfEnabled: config.csrfEnabled,
    kioskMode: config.kioskMode,
    observability: {
      enabled: config.observabilityEnabled,
      metricsEnabled: config.observabilityMetricsEnabled,
      auditEnabled: config.observabilityAuditEnabled
    },
    backup: {
      environmentLabel: config.backupEnvLabel,
      restoreRequireConfirm: config.restoreRequireConfirm
    }
  });
});

export default router;

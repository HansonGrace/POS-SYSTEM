import { Router } from "express";
import { TenderType, Role, TransactionStatus } from "@prisma/client";
import { z } from "zod";
import { requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { transactionFlow } from "../application/flows/transactionFlow.js";
import { paymentFlow } from "../application/flows/paymentFlow.js";
import { TransactionError } from "../services/core/errors.js";
import { emitSecurityEvent } from "../security/events.js";
import { incrementMetric } from "../observability/metrics.js";
import { config } from "../config.js";
import { logger } from "../logging/logger.js";

const router = Router();

const createTransactionSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  registerId: z.number().int().positive().optional(),
  registerSessionId: z.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional()
});

const addItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive(),
        unitDiscountCents: z.number().int().nonnegative().default(0)
      })
    )
    .min(1)
});

const paymentSchema = z.object({
  tenderType: z.nativeEnum(TenderType),
  amountCents: z.number().int().positive(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(240).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const refundSchema = z.object({
  transactionItemId: z.number().int().positive().optional(),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().trim().max(240).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const voidSchema = z.object({
  reason: z.string().trim().min(3).max(320).optional()
});

const paymentOperationSchema = z.object({
  reason: z.string().trim().max(240).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function parseTransactionId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function ensureTransactionReadPermission(req, transaction) {
  if (!transaction) {
    return false;
  }

  if (req.user.role === Role.ADMIN) {
    return true;
  }

  return transaction.cashierId === req.user.id;
}

function handleTransactionError(error, req, res) {
  logger.warn({
    eventType: "transaction_route_error",
    code: error?.code || null,
    message: error?.message || "unknown",
    route: req.originalUrl || req.url
  });

  if (config.observabilityMetricsEnabled) {
    incrementMetric("payment_failures_total", { code: error?.code || "UNKNOWN" });
  }

  void emitSecurityEvent(
    "payment_failed",
    { code: error?.code || "UNKNOWN", message: error?.message || "transaction route error" },
    req
  );

  if (error instanceof TransactionError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code });
  }

  if (error.code === "P2002") {
    return res.status(409).json({ message: "Transaction already exists." });
  }

  if (error.code === "P2003" || error.code === "P2025") {
    return res.status(404).json({ message: "Referenced record not found." });
  }

  return res.status(500).json({ message: "Transaction operation failed." });
}

router.post("/", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const parsed = createTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid transaction payload." });
  }

  try {
    const transaction = await transactionFlow.createTransaction(req.user.id, parsed.data);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("transactions_created_total", { actorRole: req.user.role });
    }
    await emitSecurityEvent("transaction_created", { transactionId: transaction.id }, req);
    return res.status(201).json({ transaction });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

router.get("/:id", requireAnyPermission(permissions.ORDER_READ_OWN, permissions.ORDER_READ_ALL), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const transaction = await transactionFlow.getTransactionById(id);
  if (!transaction) {
    return res.status(404).json({ message: "Transaction not found." });
  }

  if (!ensureTransactionReadPermission(req, transaction)) {
    return res.status(403).json({ message: "You can only view your own transactions." });
  }

  return res.json({ transaction });
});

router.post("/:id/items", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const parsed = addItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid line item payload." });
  }

  try {
    const transaction = await transactionFlow.addTransactionItems(req.user.id, id, parsed.data);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

router.post("/:id/finalize", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  try {
    const transaction = await transactionFlow.finalizeTransaction(req.user.id, id);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("transactions_finalized_total", { actorRole: req.user.role });
    }
    await emitSecurityEvent("transaction_finalized", { transactionId: transaction.id }, req);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

router.post("/:id/payments", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment payload." });
  }

  try {
    const result = await paymentFlow.submitTransactionPayment(req.user.id, id, {
      ...parsed.data,
      tenderType: parsed.data.tenderType
    });
    if (config.observabilityMetricsEnabled) {
      incrementMetric("payment_attempt_total", { tenderType: parsed.data.tenderType });
    }
    await emitSecurityEvent("payment_attempted", { transactionId: id, tenderType: parsed.data.tenderType }, req);
    return res.status(201).json({ transaction: result.transaction, payment: result.payment });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

router.post("/:id/payments/start", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const parsed = paymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment payload." });
  }

  try {
    const result = await paymentFlow.startPayment(req.user.id, id, {
      ...parsed.data,
      tenderType: parsed.data.tenderType
    });
    if (config.observabilityMetricsEnabled) {
      incrementMetric("payment_attempt_total", { tenderType: parsed.data.tenderType, mode: "start" });
    }
    await emitSecurityEvent("payment_attempted", { transactionId: id, tenderType: parsed.data.tenderType }, req);
    return res.status(201).json({ transaction: result.transaction, payment: result.payment });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

router.post(
  "/:transactionId/payments/:paymentId/complete",
  requirePermission(permissions.ORDER_CREATE),
  async (req, res) => {
    const transactionId = parseTransactionId(req.params.transactionId);
    const paymentId = parseTransactionId(req.params.paymentId);
    if (!transactionId || !paymentId) {
      return res.status(400).json({ message: "Invalid transaction or payment id." });
    }

    const parsed = paymentOperationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payment operation payload." });
    }

    try {
      const result = await paymentFlow.completePayment(
        req.user.id,
        paymentId,
        parsed.data.metadata,
        transactionId
      );
      await emitSecurityEvent("payment_completed", { transactionId, paymentId }, req);
      return res.json({ transaction: result.transaction, payment: result.payment });
    } catch (error) {
      return handleTransactionError(error, req, res);
    }
  }
);

router.post(
  "/:transactionId/payments/:paymentId/void",
  requirePermission(permissions.ORDER_CREATE),
  async (req, res) => {
    const transactionId = parseTransactionId(req.params.transactionId);
    const paymentId = parseTransactionId(req.params.paymentId);
    if (!transactionId || !paymentId) {
      return res.status(400).json({ message: "Invalid transaction or payment id." });
    }

    const parsed = paymentOperationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payment operation payload." });
    }

    try {
      const result = await paymentFlow.voidPayment(
        req.user.id,
        paymentId,
        parsed.data.metadata,
        transactionId
      );
      await emitSecurityEvent("payment_failed", { transactionId, paymentId, action: "void" }, req);
      return res.json({ transaction: result.transaction, payment: result.payment });
    } catch (error) {
      return handleTransactionError(error, req, res);
    }
  }
);

router.post(
  "/:transactionId/payments/:paymentId/refunds",
  requirePermission(permissions.ORDER_CREATE),
  async (req, res) => {
    const transactionId = parseTransactionId(req.params.transactionId);
    const paymentId = parseTransactionId(req.params.paymentId);
    if (!transactionId || !paymentId) {
      return res.status(400).json({ message: "Invalid transaction or payment id." });
    }

    const parsed = z
      .object({
        amountCents: z.number().int().positive().optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payment refund payload." });
    }

    try {
      const result = await paymentFlow.refundPayment(req.user.id, paymentId, parsed.data, transactionId);
      if (config.observabilityMetricsEnabled) {
        incrementMetric("refunds_issued_total", { mode: "payment_refund" });
      }
      await emitSecurityEvent("transaction_refunded", { transactionId, paymentId }, req);
      return res.json({ transaction: result.transaction, payment: result.payment });
    } catch (error) {
      return handleTransactionError(error, req, res);
    }
  }
);

router.post("/:id/refunds", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid refund payload." });
  }

  try {
    const transaction = await transactionFlow.refundTransaction(req.user.id, id, parsed.data);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("refunds_issued_total", { mode: "transaction_refund" });
    }
    await emitSecurityEvent("transaction_refunded", { transactionId: id }, req);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

router.post("/:id/void", requirePermission(permissions.ORDER_VOID_OWN), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid void payload." });
  }

  try {
    const transaction = await transactionFlow.voidTransaction(req.user.id, id, parsed.data);
    await emitSecurityEvent("transaction_voided", { transactionId: id }, req);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, req, res);
  }
});

export default router;


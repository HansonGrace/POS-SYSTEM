import { Router } from "express";
import { TenderType, Role, TransactionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import {
  createTransaction,
  addTransactionItems,
  finalizeTransaction,
  recordTransactionPayment,
  refundTransaction,
  getTransactionById,
  voidTransaction,
  TransactionError
} from "../services/transactionService.js";

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
  notes: z.string().trim().max(240).optional()
});

const refundSchema = z.object({
  transactionItemId: z.number().int().positive().optional(),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().trim().max(240).optional()
});

const voidSchema = z.object({
  reason: z.string().trim().min(3).max(320).optional()
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

function handleTransactionError(error, res) {
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
    const transaction = await createTransaction(prisma, req.user.id, parsed.data);
    return res.status(201).json({ transaction });
  } catch (error) {
    return handleTransactionError(error, res);
  }
});

router.get("/:id", requireAnyPermission(permissions.ORDER_READ_OWN, permissions.ORDER_READ_ALL), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  const transaction = await getTransactionById(prisma, id);
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
    const transaction = await addTransactionItems(prisma, req.user.id, id, parsed.data);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, res);
  }
});

router.post("/:id/finalize", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const id = parseTransactionId(req.params.id);
  if (!id) {
    return res.status(400).json({ message: "Invalid transaction id." });
  }

  try {
    const transaction = await finalizeTransaction(prisma, req.user.id, id);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, res);
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
    const result = await recordTransactionPayment(prisma, req.user.id, id, {
      ...parsed.data,
      tenderType: parsed.data.tenderType
    });
    return res.status(201).json({ transaction: result.transaction, payment: result.payment });
  } catch (error) {
    return handleTransactionError(error, res);
  }
});

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
    const transaction = await refundTransaction(prisma, req.user.id, id, parsed.data);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, res);
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
    const transaction = await voidTransaction(prisma, req.user.id, id, parsed.data);
    return res.json({ transaction });
  } catch (error) {
    return handleTransactionError(error, res);
  }
});

export default router;


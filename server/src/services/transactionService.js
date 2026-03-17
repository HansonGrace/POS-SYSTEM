import { randomUUID } from "node:crypto";
import {
  DiscountTarget,
  DiscountType,
  PaymentStatus,
  RegisterSessionStatus,
  ReceiptStatus,
  RefundStatus,
  ReturnStatus,
  TransactionPaymentStatus,
  TransactionStatus,
  TransactionTaxType
} from "@prisma/client";
import { config } from "../config.js";
import { computeTax } from "../utils/money.js";

const TAX_BASIS_POINTS = Math.max(0, Math.round(config.taxRate * 10000));

class TransactionError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "TransactionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function buildTransactionTotals(items) {
  const subtotalCents = items.reduce((sum, item) => sum + item.lineSubtotalCents, 0);
  const discountTotalCents = items.reduce((sum, item) => sum + item.discountAmountCents, 0);
  const taxTotalCents = items.reduce((sum, item) => sum + item.taxAmountCents, 0);

  return {
    subtotalCents,
    discountTotalCents,
    taxTotalCents,
    totalCents: subtotalCents + taxTotalCents
  };
}

function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TransactionError("INVALID_INPUT", `${name} must be a positive integer`, 400);
  }
}

async function getOpenSessionOrCreate(tx, { actorId, registerId, registerSessionId }) {
  if (registerSessionId !== undefined) {
    const session = await tx.registerSession.findUnique({
      where: { id: registerSessionId },
      select: {
        id: true,
        registerId: true,
        cashierId: true,
        status: true
      }
    });

    if (!session) {
      throw new TransactionError("NOT_FOUND", "register session not found", 404);
    }

    if (session.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "register session is not owned by the current user", 403);
    }

    if (session.status !== RegisterSessionStatus.OPEN) {
      throw new TransactionError("INVALID_STATE", "register session is not open", 409);
    }

    return session;
  }

  const register = registerId
    ? await tx.register.findUnique({
        where: { id: registerId },
        select: { id: true, identifier: true, active: true }
      })
    : await tx.register.findFirst({
        where: { active: true },
        select: { id: true, identifier: true, active: true },
        orderBy: { id: "asc" }
      });

  if (!register || !register.active) {
    throw new TransactionError("NOT_FOUND", "active register not found", 404);
  }

  const existingSession = await tx.registerSession.findFirst({
    where: {
      registerId: register.id,
      cashierId: actorId,
      status: RegisterSessionStatus.OPEN
    },
    orderBy: { openedAt: "desc" },
    select: { id: true }
  });

  if (existingSession) {
    return existingSession;
  }

  return tx.registerSession.create({
    data: {
      registerId: register.id,
      cashierId: actorId,
      status: RegisterSessionStatus.OPEN
    },
    select: { id: true }
  });
}

async function syncTransactionTotals(tx, transactionId) {
  const items = await tx.transactionItem.findMany({
    where: { transactionId },
    orderBy: { lineNumber: "asc" },
    select: {
      id: true,
      lineSubtotalCents: true,
      discountAmountCents: true,
      taxAmountCents: true
    }
  });

  const totals = buildTransactionTotals(items);

  await tx.transactionTax.deleteMany({ where: { transactionId } });
  if (items.length > 0) {
    await tx.transactionTax.create({
      data: {
        transactionId,
        name: "Sales Tax",
        taxType: TransactionTaxType.SALES,
        rateBasisPoints: TAX_BASIS_POINTS,
        taxableAmountCents: totals.subtotalCents,
        amountCents: totals.taxTotalCents
      }
    });
  }

  await tx.transaction.update({
    where: { id: transactionId },
    data: {
      subtotalCents: totals.subtotalCents,
      discountTotalCents: totals.discountTotalCents,
      taxTotalCents: totals.taxTotalCents,
      totalCents: totals.totalCents
    }
  });

  return totals;
}

async function emitStatusHistory(tx, { transactionId, actorId, status, reason, metadata }) {
  await tx.transactionStatusHistory.create({
    data: {
      transactionId,
      status,
      changedById: actorId,
      reason,
      metadata
    }
  });
}

export async function getTransactionById(prisma, id) {
  return prisma.transaction.findUnique({
    where: { id },
    include: {
      cashier: {
        select: {
          id: true,
          username: true,
          role: true
        }
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true
        }
      },
      registerSession: {
        select: {
          id: true,
          status: true,
          openedAt: true,
          closedAt: true,
          register: {
            select: {
              id: true,
              identifier: true,
              name: true
            }
          }
        }
      },
      items: {
        orderBy: { lineNumber: "asc" }
      },
      discounts: {
        orderBy: { id: "asc" }
      },
      taxes: {
        orderBy: { id: "asc" }
      },
      payments: {
        orderBy: { createdAt: "asc" }
      },
      returns: {
        orderBy: { createdAt: "desc" }
      },
      refunds: {
        orderBy: { createdAt: "desc" }
      },
      statusHistory: {
        orderBy: { createdAt: "desc" }
      },
      receipt: true
    }
  });
}

export async function createTransaction(prisma, actorId, payload) {
  const { customerId, registerId, registerSessionId, notes } = payload;

  return prisma.$transaction(async (tx) => {
    const session = await getOpenSessionOrCreate(tx, {
      actorId,
      registerId,
      registerSessionId
    });

    const transaction = await tx.transaction.create({
      data: {
        transactionNumber: `TX-${Date.now()}-${randomUUID().slice(0, 10)}`,
        cashierId: actorId,
        customerId: customerId || null,
        registerSessionId: session.id,
        notes: notes || null,
        status: TransactionStatus.DRAFT
      }
    });

    await emitStatusHistory(tx, {
      transactionId: transaction.id,
      actorId,
      status: TransactionStatus.DRAFT,
      reason: "created",
      metadata: { registerSessionId: session.id }
    });

    return getTransactionById(tx, transaction.id);
  });
}

export async function addTransactionItems(prisma, actorId, transactionId, payload) {
  const items = payload.items;
  if (!items.length) {
    throw new TransactionError("INVALID_INPUT", "line items are required", 400);
  }

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        status: true,
        cashierId: true
      }
    });

    if (!transaction) {
      throw new TransactionError("NOT_FOUND", "transaction not found", 404);
    }

    if (transaction.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "you can only edit your own transaction", 403);
    }

    if (transaction.status !== TransactionStatus.DRAFT) {
      throw new TransactionError("INVALID_STATE", "only draft transactions can be edited", 409);
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const products = await tx.product.findMany({
      where: {
        id: { in: productIds },
        active: true
      },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        category: true,
        priceCents: true,
        inventoryCount: true
      }
    });

    if (products.length !== productIds.length) {
      throw new TransactionError("NOT_FOUND", "one or more products are unavailable", 400);
    }

    const byId = new Map(products.map((product) => [product.id, product]));
    const latestLine = await tx.transactionItem.findFirst({
      where: { transactionId },
      orderBy: { lineNumber: "desc" },
      select: { lineNumber: true }
    });
    let nextLineNumber = (latestLine?.lineNumber ?? 0) + 1;

    for (const item of items) {
      const product = byId.get(item.productId);
      if (!product) {
        throw new TransactionError("NOT_FOUND", "product not found", 404);
      }

      const quantity = item.quantity;
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new TransactionError("INVALID_INPUT", "quantity must be a positive integer", 400);
      }

      const discount = Math.max(0, item.unitDiscountCents);
      if (!Number.isInteger(discount) || discount < 0) {
        throw new TransactionError("INVALID_INPUT", "discount must be a non-negative integer", 400);
      }

      const lineSubtotal = product.priceCents * quantity - discount;
      if (lineSubtotal < 0) {
        throw new TransactionError("INVALID_INPUT", "line discount can not exceed line value", 400);
      }

      const tax = computeTax(lineSubtotal, config.taxRate);
      const lineTotal = lineSubtotal + tax;

      const createdItem = await tx.transactionItem.create({
        data: {
          transactionId,
          lineNumber: nextLineNumber,
          productId: product.id,
          productNameSnapshot: product.name,
          productSkuSnapshot: product.sku,
          productBarcodeSnapshot: product.barcode,
          productCategorySnapshot: product.category,
          quantity,
          unitPriceCents: product.priceCents,
          discountAmountCents: discount,
          taxAmountCents: tax,
          lineSubtotalCents: lineSubtotal,
          lineTotalCents: lineTotal
        }
      });

      if (discount > 0) {
        await tx.transactionDiscount.create({
          data: {
            transactionId,
            transactionItemId: createdItem.id,
            name: "Line discount",
            discountType: DiscountType.AMOUNT,
            target: DiscountTarget.ITEM,
            amountCents: discount
          }
        });
      }

      nextLineNumber += 1;
    }

    const totals = await syncTransactionTotals(tx, transaction.id);

    await emitStatusHistory(tx, {
      transactionId,
      actorId,
      status: TransactionStatus.DRAFT,
      reason: "items_added",
      metadata: {
        addedItems: items.length,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxTotalCents,
        totalCents: totals.totalCents
      }
    });

    return getTransactionById(tx, transaction.id);
  });
}

export async function finalizeTransaction(prisma, actorId, transactionId) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            lineTotalCents: true,
            isReturned: true
          }
        }
      }
    });

    if (!transaction) {
      throw new TransactionError("NOT_FOUND", "transaction not found", 404);
    }

    if (transaction.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "you can only finalize your own transaction", 403);
    }

    if (transaction.status !== TransactionStatus.DRAFT) {
      throw new TransactionError("INVALID_STATE", "only draft transactions can be finalized", 409);
    }

    if (transaction.items.length === 0) {
      throw new TransactionError("INVALID_STATE", "transaction has no line items", 409);
    }

    for (const item of transaction.items) {
      if (!item.productId) {
        continue;
      }

      const productUpdateResult = await tx.product.updateMany({
        where: {
          id: item.productId,
          active: true,
          inventoryCount: { gte: item.quantity }
        },
        data: {
          inventoryCount: { decrement: item.quantity }
        }
      });

      if (productUpdateResult.count !== 1) {
        throw new TransactionError(
          "INVALID_STATE",
          `insufficient inventory for product id ${item.productId} while finalizing`,
          409
        );
      }
    }

    const totals = await syncTransactionTotals(tx, transaction.id);
    const paymentAggregate = await tx.transactionPayment.aggregate({
      where: {
        transactionId: transaction.id,
        status: PaymentStatus.CAPTURED
      },
      _sum: { amountCents: true }
    });
    const capturedCents = paymentAggregate._sum.amountCents || 0;

    const paymentStatus =
      capturedCents >= totals.totalCents
        ? TransactionPaymentStatus.PAID
        : capturedCents > 0
          ? TransactionPaymentStatus.PARTIALLY_PAID
          : TransactionPaymentStatus.PENDING;

    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.FINALIZED,
        finalizedAt: new Date(),
        paymentStatus
      }
    });

    const existingReceipt = await tx.receipt.findUnique({
      where: { transactionId: transaction.id }
    });
    if (!existingReceipt) {
      await tx.receipt.create({
        data: {
          transactionId: transaction.id,
          cashierId: actorId,
          receiptNumber: `R-${transaction.transactionNumber}`,
          payload: {
            transactionNumber: transaction.transactionNumber,
            cashierId: actorId,
            lineItems: transaction.items.length,
            subtotalCents: totals.subtotalCents,
            taxCents: totals.taxTotalCents,
            totalCents: totals.totalCents
          }
        }
      });
    }

    await emitStatusHistory(tx, {
      transactionId: transaction.id,
      actorId,
      status: TransactionStatus.FINALIZED,
      reason: "finalized",
      metadata: {
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxTotalCents,
        totalCents: totals.totalCents,
        paymentStatus
      }
    });

    return getTransactionById(tx, transaction.id);
  });
}

export async function recordTransactionPayment(prisma, actorId, transactionId, payload) {
  assertPositiveInteger(payload.amountCents, "amountCents");

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        cashierId: true,
        status: true,
        totalCents: true
      }
    });

    if (!transaction) {
      throw new TransactionError("NOT_FOUND", "transaction not found", 404);
    }

    if (transaction.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "you can only pay your own transactions", 403);
    }

    if (
      transaction.status === TransactionStatus.VOIDED ||
      transaction.status === TransactionStatus.FULLY_REFUNDED ||
      transaction.status === TransactionStatus.PARTIALLY_REFUNDED
    ) {
      throw new TransactionError("INVALID_STATE", "payments are not allowed for voided/refunded transactions", 409);
    }

    const paymentAggregate = await tx.transactionPayment.aggregate({
      where: {
        transactionId: transaction.id,
        status: PaymentStatus.CAPTURED
      },
      _sum: { amountCents: true }
    });

    const alreadyCaptured = paymentAggregate._sum.amountCents || 0;
    const remaining = transaction.totalCents - alreadyCaptured;

    if (remaining < 0) {
      throw new TransactionError("INVALID_STATE", "payment state is inconsistent", 409);
    }

    if (payload.amountCents > remaining) {
      throw new TransactionError("OVER_PAYMENT", "payment exceeds remaining amount", 409);
    }

    const payment = await tx.transactionPayment.create({
      data: {
        transactionId: transaction.id,
        cashierId: actorId,
        tenderType: payload.tenderType,
        status: PaymentStatus.CAPTURED,
        amountCents: payload.amountCents,
        reference: payload.reference || null,
        notes: payload.notes || null
      }
    });

    const capturedAfter = alreadyCaptured + payload.amountCents;
    const paymentStatus =
      capturedAfter >= transaction.totalCents
        ? TransactionPaymentStatus.PAID
        : capturedAfter > 0
          ? TransactionPaymentStatus.PARTIALLY_PAID
          : TransactionPaymentStatus.PENDING;

    const updatedTransaction = await tx.transaction.update({
      where: { id: transaction.id },
      data: { paymentStatus },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        subtotalCents: true,
        discountTotalCents: true,
        taxTotalCents: true,
        totalCents: true,
        updatedAt: true
      }
    });

    return {
      payment,
      transaction: updatedTransaction
    };
  });
}

export async function refundTransaction(prisma, actorId, transactionId, payload) {
  const { transactionItemId, amountCents, reason } = payload;

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        items: {
          select: {
            id: true,
            quantity: true,
            lineTotalCents: true,
            isReturned: true,
            productId: true
          }
        }
      }
    });

    if (!transaction) {
      throw new TransactionError("NOT_FOUND", "transaction not found", 404);
    }

    if (transaction.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "you can only refund your own transactions", 403);
    }

    if (transaction.status === TransactionStatus.VOIDED || transaction.status === TransactionStatus.DRAFT) {
      throw new TransactionError("INVALID_STATE", "this transaction cannot be refunded", 409);
    }

    const refundedAggregate = await tx.refund.aggregate({
      where: {
        transactionId: transaction.id,
        status: RefundStatus.COMPLETED
      },
      _sum: { amountCents: true }
    });

    const alreadyRefunded = refundedAggregate._sum.amountCents || 0;
    const refundableTransaction = Math.max(0, transaction.totalCents - alreadyRefunded);

    const payloadReason = reason && reason.trim() ? reason.trim() : "Refund requested";
    const lineItem =
      transactionItemId === undefined
        ? null
        : transaction.items.find((item) => item.id === transactionItemId);

    if (transactionItemId !== undefined && !lineItem) {
      throw new TransactionError("NOT_FOUND", "transaction item not found", 404);
    }

    if (lineItem) {
      const existingItemRefunds = await tx.refund.aggregate({
        where: {
          transactionId: transaction.id,
          transactionItemId: lineItem.id,
          status: RefundStatus.COMPLETED
        },
        _sum: { amountCents: true }
      });

      const refundedForItem = existingItemRefunds._sum.amountCents || 0;
      const refundableForItem = Math.max(0, lineItem.lineTotalCents - refundedForItem);
      if (refundableForItem <= 0) {
        throw new TransactionError("INVALID_STATE", "transaction item is already fully refunded", 409);
      }

      const requested = amountCents === undefined ? refundableForItem : amountCents;
      assertPositiveInteger(requested, "amountCents");

      if (requested > refundableForItem) {
        throw new TransactionError("OVER_REFUND", "refund exceeds refundable amount for line item", 409);
      }

      const returnRecord = await tx.return.create({
        data: {
          originalTransactionId: transaction.id,
          cashierId: actorId,
          status: ReturnStatus.COMPLETED,
          reason: payloadReason
        }
      });

      await tx.refund.create({
        data: {
          transactionId: transaction.id,
          transactionItemId: lineItem.id,
          returnId: returnRecord.id,
          cashierId: actorId,
          status: RefundStatus.COMPLETED,
          amountCents: requested,
          reason: payloadReason
        }
      });

      if (requested === refundableForItem && !lineItem.isReturned && lineItem.productId) {
        await tx.transactionItem.update({
          where: { id: lineItem.id },
          data: {
            isReturned: true,
            refundedQuantity: lineItem.quantity
          }
        });

        await tx.product.updateMany({
          where: { id: lineItem.productId },
          data: {
            inventoryCount: { increment: lineItem.quantity }
          }
        });
      }

      const latestRefundedTotal =
        (await tx.refund.aggregate({
          where: {
            transactionId: transaction.id,
            status: RefundStatus.COMPLETED
          },
          _sum: { amountCents: true }
        }))._sum.amountCents || 0;

      const nextStatus =
        latestRefundedTotal >= transaction.totalCents
          ? TransactionStatus.FULLY_REFUNDED
          : TransactionStatus.PARTIALLY_REFUNDED;

      await tx.transaction.update({
        where: { id: transaction.id },
        data: {
          status: nextStatus,
          paymentStatus:
            latestRefundedTotal >= transaction.totalCents
              ? TransactionPaymentStatus.REFUNDED
              : TransactionPaymentStatus.PARTIALLY_PAID
        }
      });

      await emitStatusHistory(tx, {
        transactionId: transaction.id,
        actorId,
        status: nextStatus,
        reason: "line_refund",
        metadata: {
          transactionItemId,
          amountCents: requested
        }
      });

      return getTransactionById(tx, transaction.id);
    }

    if (refundableTransaction <= 0) {
      throw new TransactionError("INVALID_STATE", "transaction is already fully refunded", 409);
    }

    if (amountCents !== undefined) {
      assertPositiveInteger(amountCents, "amountCents");
    }
    const requested = amountCents === undefined ? refundableTransaction : amountCents;
    if (requested > refundableTransaction) {
      throw new TransactionError("OVER_REFUND", "refund exceeds refundable amount", 409);
    }

    const partialRefundItem = await tx.refund.findFirst({
      where: {
        transactionId: transaction.id,
        status: RefundStatus.COMPLETED,
        transactionItemId: { not: null }
      }
    });

    if (requested === refundableTransaction && partialRefundItem) {
      throw new TransactionError(
        "INVALID_STATE",
        "transaction-level full refunds are not allowed after line-item refunds",
        409
      );
    }

    const returnRecord = await tx.return.create({
      data: {
        originalTransactionId: transaction.id,
        cashierId: actorId,
        status: ReturnStatus.COMPLETED,
        reason: payloadReason
      }
    });

    await tx.refund.create({
      data: {
        transactionId: transaction.id,
        returnId: returnRecord.id,
        cashierId: actorId,
        status: RefundStatus.COMPLETED,
        amountCents: requested,
        reason: payloadReason
      }
    });

    const latestRefundedTotal = alreadyRefunded + requested;
    const nextStatus =
      latestRefundedTotal >= transaction.totalCents
        ? TransactionStatus.FULLY_REFUNDED
        : TransactionStatus.PARTIALLY_REFUNDED;

    if (nextStatus === TransactionStatus.FULLY_REFUNDED) {
      for (const item of transaction.items) {
        if (item.isReturned) {
          continue;
        }

        if (item.productId) {
          await tx.product.updateMany({
            where: { id: item.productId },
            data: { inventoryCount: { increment: item.quantity } }
          });
        }

        await tx.transactionItem.update({
          where: { id: item.id },
          data: { isReturned: true, refundedQuantity: item.quantity }
        });
      }
    }

    await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: nextStatus,
        paymentStatus:
          latestRefundedTotal >= transaction.totalCents
            ? TransactionPaymentStatus.REFUNDED
            : TransactionPaymentStatus.PARTIALLY_PAID
      }
    });

    await emitStatusHistory(tx, {
      transactionId: transaction.id,
      actorId,
      status: nextStatus,
      reason: "refund",
      metadata: {
        amountCents: requested
      }
    });

    return getTransactionById(tx, transaction.id);
  });
}

export async function voidTransaction(prisma, actorId, transactionId, payload) {
  const reason = payload.reason?.trim() || "Voided by cashier";

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: {
        items: {
          select: {
            id: true,
            isReturned: true,
            isVoided: true,
            productId: true,
            quantity: true
          }
        },
        receipt: {
          select: {
            id: true
          }
        }
      }
    });

    if (!transaction) {
      throw new TransactionError("NOT_FOUND", "transaction not found", 404);
    }

    if (transaction.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "you can only void your own transactions", 403);
    }

    if (transaction.status === TransactionStatus.VOIDED) {
      throw new TransactionError("INVALID_STATE", "transaction is already voided", 409);
    }

    if (
      transaction.status !== TransactionStatus.DRAFT &&
      transaction.status !== TransactionStatus.FINALIZED
    ) {
      throw new TransactionError("INVALID_STATE", "only draft or finalized transactions can be voided", 409);
    }

    if (transaction.status === TransactionStatus.FINALIZED) {
      for (const item of transaction.items) {
        if (item.isVoided || item.isReturned) {
          continue;
        }

        if (item.productId) {
          await tx.product.updateMany({
            where: { id: item.productId },
            data: {
              inventoryCount: { increment: item.quantity }
            }
          });
        }

        await tx.transactionItem.update({
          where: { id: item.id },
          data: {
            isVoided: true
          }
        });
      }
    }

    const voided = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.VOIDED,
        voidedAt: new Date(),
        voidReason: reason,
        paymentStatus: TransactionPaymentStatus.VOIDED
      }
    });

    if (transaction.receipt) {
      await tx.receipt.update({
        where: { id: transaction.receipt.id },
        data: {
          status: ReceiptStatus.VOIDED
        }
      });
    }

    await emitStatusHistory(tx, {
      transactionId: transaction.id,
      actorId,
      status: TransactionStatus.VOIDED,
      reason: "void",
      metadata: { voidReason: reason }
    });

    return getTransactionById(tx, voided.id);
  });
}

export { TransactionError };


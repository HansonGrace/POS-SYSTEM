import { PaymentStatus, TransactionPaymentStatus, TransactionStatus } from "@prisma/client";
import { TransactionError } from "../core/errors.js";
import { resolveActiveUser } from "../core/userContextService.js";
import {
  assertPaymentStatusTransition,
  isPaymentRefundableStatus,
  resolveTransactionPaymentStatusFromPayments,
  sumCapturedPaymentCents
} from "../core/paymentService.js";
import {
  assertPositiveAmount,
  assertRemainingPayment,
  assertRefundable,
  assertTransactionEditableByActor,
  assertTransactionSupportsPayment
} from "./paymentValidationService.js";
import { resolvePaymentProvider } from "./paymentProviderService.js";

function assertPaymentBelongsToTransaction(payment, expectedTransactionId) {
  if (!expectedTransactionId) {
    return;
  }

  if (payment.transactionId !== expectedTransactionId) {
    throw new TransactionError("INVALID_STATE", "payment does not belong to the requested transaction", 409);
  }
}

async function loadActor(prisma, actorId) {
  const user = await resolveActiveUser(prisma, actorId);
  if (!user) {
    throw new TransactionError("NOT_AUTHENTICATED", "authentication required", 401);
  }
  return user;
}

async function getTransactionWithPayments(tx, transactionId) {
  return tx.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      cashierId: true,
      status: true,
      totalCents: true,
      paymentStatus: true,
      payments: {
        select: {
          id: true,
          status: true,
          amountCents: true,
          capturedAmountCents: true,
          refundedAmountCents: true
        }
      }
    }
  });
}

async function getPaymentForAction(tx, paymentId) {
  return tx.transactionPayment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      transactionId: true,
      cashierId: true,
      status: true,
      tenderType: true,
      amountCents: true,
      capturedAmountCents: true,
      refundedAmountCents: true,
      reference: true,
      provider: true,
      providerReference: true
    }
  });
}

async function writePaymentStatusHistory(tx, paymentId, actorId, previousStatus, nextStatus, reason) {
  await tx.paymentStatusHistory.create({
    data: {
      paymentId,
      previousStatus,
      nextStatus,
      actorId,
      reason
    }
  });
}

async function writePaymentAttempt(tx, paymentId, actorId, attempt) {
  await tx.paymentAttempt.create({
    data: {
      paymentId,
      actorId,
      status: attempt.status,
      amountCents: attempt.amountCents,
      provider: attempt.provider,
      providerReference: attempt.providerReference || null,
      reference: attempt.reference || null,
      errorCode: attempt.errorCode || null,
      errorMessage: attempt.errorMessage || null,
      payload: attempt.payload || null
    }
  });
}

async function recalculateTransactionPaymentStatus(tx, transactionId) {
  const payments = await tx.transactionPayment.findMany({
    where: { transactionId },
    select: {
      status: true,
      capturedAmountCents: true,
      refundedAmountCents: true
    }
  });

  const transaction = await tx.transaction.findUnique({
    where: { id: transactionId },
    select: { id: true, totalCents: true }
  });
  if (!transaction) {
    return null;
  }

  const computedStatus = resolveTransactionPaymentStatusFromPayments(transaction.totalCents, payments);
  return tx.transaction.update({
    where: { id: transactionId },
    data: { paymentStatus: computedStatus }
  });
}

async function getTransactionSnapshot(tx, transactionId) {
  return tx.transaction.findUnique({
    where: { id: transactionId },
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

function applyMetadataFromContext(context) {
  const metadata = context.metadata ?? {};
  if (context.reason) {
    metadata.reason = context.reason;
  }
  if (context.reference) {
    metadata.reference = context.reference;
  }
  return metadata;
}

async function resolveTransactionGuard(tx, actor, transactionId, requireCashierOnly = true) {
  const transaction = await getTransactionWithPayments(tx, transactionId);
  assertTransactionSupportsPayment(transaction);
  assertTransactionEditableByActor(transaction, actor.id, actor.role);

  if (
    transaction.status === "DRAFT" ||
    transaction.status === "FINALIZED" ||
    transaction.status === "PARTIALLY_REFUNDED" ||
    transaction.status === "FULLY_REFUNDED"
  ) {
    // allowed states
  } else if (transaction.status === "VOIDED") {
    throw new TransactionError("INVALID_STATE", "transaction is already voided", 409);
  } else {
    throw new TransactionError("INVALID_STATE", "transaction is in an unsupported payment state", 409);
  }

  if (requireCashierOnly && actor.role === "CASHIER" && transaction.cashierId !== actor.id) {
    throw new TransactionError("FORBIDDEN", "you can only manage your own transactions", 403);
  }

  return transaction;
}

function buildProviderContext(payload, payment) {
  return {
    amountCents: payload.amountCents ?? payment?.amountCents,
    transactionId: payload.transactionId || payment?.transactionId,
    tenderType: payload.tenderType || payment?.tenderType,
    reference: payload.reference,
    metadata: payload.metadata
  };
}

export async function startPayment(prisma, actorId, transactionId, payload) {
  const actor = await loadActor(prisma, actorId);

  return prisma.$transaction(async (tx) => {
    const transaction = await resolveTransactionGuard(tx, actor, transactionId);
    const provider = resolvePaymentProvider(payload.tenderType);
    if (!provider) {
      throw new TransactionError("UNSUPPORTED_TENDER", "unsupported payment method", 400);
    }

    const captured = sumCapturedPaymentCents(transaction.payments);
    assertPositiveAmount(payload.amountCents);
    assertRemainingPayment(transaction.totalCents, captured, payload.amountCents);

    const authResult = await provider.authorize(buildProviderContext(payload));
    const status = authResult.status || PaymentStatus.PENDING;

    const payment = await tx.transactionPayment.create({
      data: {
        transactionId: transaction.id,
        cashierId: actor.id,
        tenderType: payload.tenderType,
        status,
        amountCents: payload.amountCents,
        provider: provider.name,
        providerReference: authResult.providerReference || null,
        metadata: authResult.metadata ? authResult.metadata : {
          providerResult: status === PaymentStatus.FAILED ? "failed" : "authorized",
          startedBy: actor.username,
          startedAt: new Date().toISOString()
        },
        capturedAmountCents: authResult.capturedAmountCents || 0,
        refundedAmountCents: 0,
        reference: payload.reference || null,
        notes: payload.notes || null
      }
    });

    await writePaymentAttempt(tx, payment.id, actor.id, {
      status,
      amountCents: payload.amountCents,
      provider: provider.name,
      providerReference: authResult.providerReference,
      reference: payload.reference,
      errorCode: authResult.errorCode,
      errorMessage: authResult.errorMessage
    });
    await writePaymentStatusHistory(tx, payment.id, actor.id, null, status, "started");

    if (status === PaymentStatus.FAILED) {
      await recalculateTransactionPaymentStatus(tx, transaction.id);
      return { payment, transaction: await getTransactionSnapshot(tx, transaction.id) };
    }

    if ([PaymentStatus.COMPLETED, PaymentStatus.CAPTURED].includes(status)) {
      await recalculateTransactionPaymentStatus(tx, transaction.id);
    }

    return { payment, transaction: await getTransactionSnapshot(tx, transaction.id) };
  });
}

async function completePaymentInternal(tx, actor, paymentId, metadata, transactionId) {
  const payment = await getPaymentForAction(tx, paymentId);
  if (!payment) {
    throw new TransactionError("NOT_FOUND", "payment not found", 404);
  }

  const transaction = await resolveTransactionGuard(tx, actor, payment.transactionId);
  assertPaymentBelongsToTransaction(payment, transactionId);
  if (payment.cashierId !== transaction.cashierId) {
    throw new TransactionError("FORBIDDEN", "you can only complete your own payment", 403);
  }

  if (payment.status === PaymentStatus.COMPLETED || payment.status === PaymentStatus.CAPTURED) {
    throw new TransactionError("INVALID_STATE", "payment is already completed", 409);
  }

  if (payment.status !== PaymentStatus.AUTHORIZED && payment.status !== PaymentStatus.PENDING) {
    throw new TransactionError("INVALID_STATE", "payment cannot be completed in its current state", 409);
  }

  const provider = resolvePaymentProvider(payment.tenderType);
  const captured = sumCapturedPaymentCents(transaction.payments);
  assertRemainingPayment(transaction.totalCents, captured, payment.amountCents);

  const captureResult = await provider.capture({
    amountCents: payment.amountCents,
    reference: payment.reference,
    metadata
  });

  assertPaymentStatusTransition(payment.status, captureResult.status);
  const nextCaptured = Number(captureResult.capturedAmountCents || payment.amountCents);
  const nextStatus = captureResult.status;

  const updated = await tx.transactionPayment.update({
    where: { id: payment.id },
    data: {
      status: nextStatus,
      providerReference: captureResult.providerReference || payment.providerReference,
      capturedAmountCents: nextCaptured,
      metadata: {
        ...(payment.metadata && typeof payment.metadata === "object" ? payment.metadata : {}),
        providerResult: "completed",
        completedAt: new Date().toISOString()
      }
    }
  });

  await writePaymentAttempt(tx, payment.id, actor.id, {
    status: nextStatus,
    amountCents: payment.amountCents,
    provider: provider.name,
    providerReference: captureResult.providerReference,
    reference: payment.reference,
    errorCode: captureResult.errorCode,
    errorMessage: captureResult.errorMessage,
    payload: { metadata: applyMetadataFromContext(metadata), captureResult }
  });

    await writePaymentStatusHistory(tx, payment.id, actor.id, payment.status, nextStatus, "completed");
    await recalculateTransactionPaymentStatus(tx, transaction.id);

  return { payment: updated, transaction: await getTransactionSnapshot(tx, payment.transactionId) };
}

export async function completePayment(prisma, actorId, paymentId, metadata = {}, transactionId = null) {
  const actor = await loadActor(prisma, actorId);
  return prisma.$transaction(async (tx) => completePaymentInternal(tx, actor, paymentId, metadata, transactionId));
}

export async function failPayment(prisma, actorId, paymentId, metadata = {}, transactionId = null) {
  const actor = await loadActor(prisma, actorId);
  return prisma.$transaction(async (tx) => {
    const payment = await getPaymentForAction(tx, paymentId);
    if (!payment) {
      throw new TransactionError("NOT_FOUND", "payment not found", 404);
    }

    const transaction = await resolveTransactionGuard(tx, actor, payment.transactionId);
    assertPaymentBelongsToTransaction(payment, transactionId);
    if (payment.cashierId !== transaction.cashierId) {
      throw new TransactionError("FORBIDDEN", "you can only fail your own payment", 403);
    }

    if (payment.status === PaymentStatus.FAILED) {
      throw new TransactionError("INVALID_STATE", "payment already failed", 409);
    }

    assertPaymentStatusTransition(payment.status, PaymentStatus.FAILED);

    const updated = await tx.transactionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.FAILED,
        metadata: { ...(payment.metadata || {}), providerResult: "failed", failedAt: new Date().toISOString() }
      }
    });

    await writePaymentAttempt(tx, payment.id, actor.id, {
      status: PaymentStatus.FAILED,
      amountCents: payment.amountCents,
      provider: payment.provider || "unknown",
      reference: payment.reference,
      payload: { metadata: applyMetadataFromContext(metadata) }
    });
    await writePaymentStatusHistory(tx, payment.id, actor.id, payment.status, PaymentStatus.FAILED, "failed");
    await recalculateTransactionPaymentStatus(tx, payment.transactionId);

    return { payment: updated, transaction: await getTransactionSnapshot(tx, payment.transactionId) };
  });
}

export async function voidPayment(prisma, actorId, paymentId, metadata = {}, transactionId = null) {
  const actor = await loadActor(prisma, actorId);

  return prisma.$transaction(async (tx) => {
    const payment = await getPaymentForAction(tx, paymentId);
    if (!payment) {
      throw new TransactionError("NOT_FOUND", "payment not found", 404);
    }

    const transaction = await resolveTransactionGuard(tx, actor, payment.transactionId);
    assertPaymentBelongsToTransaction(payment, transactionId);
    if (payment.cashierId !== transaction.cashierId) {
      throw new TransactionError("FORBIDDEN", "you can only void your own payment", 403);
    }

    if (payment.status === PaymentStatus.VOIDED) {
      throw new TransactionError("INVALID_STATE", "payment already voided", 409);
    }
    if (payment.status === PaymentStatus.FAILED) {
      throw new TransactionError("INVALID_STATE", "failed payments can only be retried after creating a new payment", 409);
    }
    if ([PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status)) {
      if ((payment.refundedAmountCents || 0) > 0) {
        throw new TransactionError("INVALID_STATE", "refunded payment cannot be voided", 409);
      }
    }

    const provider = resolvePaymentProvider(payment.tenderType);
    const voidResult = await provider.void({
      amountCents: payment.amountCents,
      metadata
    });

    assertPaymentStatusTransition(payment.status, voidResult.status);
    const updated = await tx.transactionPayment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.VOIDED,
        metadata: { ...(payment.metadata || {}), providerResult: "voided", voidedAt: new Date().toISOString() }
      }
    });

    await writePaymentAttempt(tx, payment.id, actor.id, {
      status: voidResult.status,
      amountCents: payment.amountCents,
      provider: provider.name,
      providerReference: voidResult.providerReference,
      reference: payment.reference,
      payload: { metadata: applyMetadataFromContext(metadata), voidResult }
    });

    await writePaymentStatusHistory(tx, payment.id, actor.id, payment.status, voidResult.status, "voided");
    await recalculateTransactionPaymentStatus(tx, payment.transactionId);

    const finalTransaction = await tx.transaction.findUnique({
      where: { id: payment.transactionId },
      select: { id: true, status: true, paymentStatus: true, totalCents: true }
    });

    if (
      finalTransaction?.status === TransactionStatus.FINALIZED &&
      finalTransaction.paymentStatus === TransactionPaymentStatus.PAID
    ) {
      await tx.transaction.update({
        where: { id: finalTransaction.id },
        data: { paymentStatus: TransactionPaymentStatus.PARTIALLY_PAID }
      });
    }

    return { payment: updated, transaction: await getTransactionSnapshot(tx, payment.transactionId) };
  });
}

export async function refundPayment(prisma, actorId, paymentId, payload, transactionId = null) {
  const actor = await loadActor(prisma, actorId);
  const requestedAmount = payload?.amountCents;

  return prisma.$transaction(async (tx) => {
    const payment = await getPaymentForAction(tx, paymentId);
    if (!payment) {
      throw new TransactionError("NOT_FOUND", "payment not found", 404);
    }

    const transaction = await resolveTransactionGuard(tx, actor, payment.transactionId);
    assertPaymentBelongsToTransaction(payment, transactionId);
    if (payment.cashierId !== transaction.cashierId) {
      throw new TransactionError("FORBIDDEN", "you can only refund your own payment", 403);
    }

    const amountToRefund =
      requestedAmount === undefined
        ? Math.max(0, payment.capturedAmountCents - (payment.refundedAmountCents || 0))
        : requestedAmount;
    assertPositiveAmount(amountToRefund);
    assertRefundable(payment, amountToRefund);

    const currentStatus = payment.status;
    if (!isPaymentRefundableStatus(currentStatus)) {
      throw new TransactionError("INVALID_STATE", "payment cannot be refunded", 409);
    }

    const provider = resolvePaymentProvider(payment.tenderType);
    const refundResult = await provider.refund({
      amountCents: amountToRefund,
      reference: payload?.reference,
      metadata: payload?.metadata
    });

    const remainingAfterRefund = (payment.refundedAmountCents || 0) + amountToRefund;
    const refundedStatus =
      remainingAfterRefund >= (payment.capturedAmountCents || payment.amountCents)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    assertPaymentStatusTransition(currentStatus, refundedStatus);

    const updated = await tx.transactionPayment.update({
      where: { id: payment.id },
      data: {
        status: refundedStatus,
        refundedAmountCents: remainingAfterRefund,
        metadata: {
          ...(payment.metadata || {}),
          providerResult: "refunded",
          refundedAmount: remainingAfterRefund,
          refundedAt: new Date().toISOString()
        }
      }
    });

    await writePaymentAttempt(tx, payment.id, actor.id, {
      status: refundResult.status,
      amountCents: amountToRefund,
      provider: provider.name,
      reference: payload?.reference || payment.reference,
      payload: { metadata: applyMetadataFromContext(payload || {}), refundResult }
    });

    await writePaymentStatusHistory(tx, payment.id, actor.id, currentStatus, refundedStatus, "refunded");
    await recalculateTransactionPaymentStatus(tx, payment.transactionId);

    return { payment: updated, transaction: await getTransactionSnapshot(tx, payment.transactionId) };
  });
}

export async function submitTransactionPayment(prisma, actorId, transactionId, payload) {
  const started = await startPayment(prisma, actorId, transactionId, payload);
  if (started.payment.status === PaymentStatus.FAILED) {
    return started;
  }

  if (started.payment.status === PaymentStatus.COMPLETED) {
    return started;
  }

  return completePayment(prisma, actorId, started.payment.id, {}, started.transaction?.id ?? transactionId);
}

import { TransactionError } from "../core/errors.js";
import { PaymentStatus } from "@prisma/client";
import { sumCapturedPaymentCents, hasRemainingPayment } from "../core/paymentService.js";

export function assertPositiveAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new TransactionError("INVALID_INPUT", "amountCents must be a positive integer", 400);
  }
}

export function assertTransactionSupportsPayment(transaction) {
  if (!transaction) {
    throw new TransactionError("NOT_FOUND", "transaction not found", 404);
  }

  if (transaction.status === "VOIDED") {
    throw new TransactionError("INVALID_STATE", "voided transactions cannot accept payments", 409);
  }
}

export function assertTransactionEditableByActor(transaction, actorId, role, permissionName = "edit") {
  if (role === "ADMIN") {
    return;
  }

  if (transaction.cashierId !== actorId) {
    throw new TransactionError("FORBIDDEN", `you can only ${permissionName} your own transactions`, 403);
  }
}

export function assertRemainingPayment(totalCents, capturedPaymentCents, requestedAmount) {
  const remaining = hasRemainingPayment(totalCents, capturedPaymentCents);
  if (remaining <= 0) {
    throw new TransactionError("OVER_PAYMENT", "transaction already fully paid", 409);
  }

  if (requestedAmount > remaining) {
    throw new TransactionError("OVER_PAYMENT", "payment exceeds remaining amount", 409);
  }
}

export function assertRefundable(payment, requestedAmount) {
  if (![PaymentStatus.CAPTURED, PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED].includes(payment.status)) {
    throw new TransactionError("INVALID_STATE", "payment is not eligible for refund", 409);
  }

  const alreadyRefunded = Number(payment.refundedAmountCents || 0);
  const refundable = Number(payment.capturedAmountCents || 0) - alreadyRefunded;
  if (refundable <= 0) {
    throw new TransactionError("INVALID_STATE", "nothing left to refund on this payment", 409);
  }

  if (requestedAmount > refundable) {
    throw new TransactionError("OVER_REFUND", "refund exceeds available payment balance", 409);
  }
}

export function summarizePaymentCapture(payments) {
  return {
    capturedCents: sumCapturedPaymentCents(payments),
    totalPayments: payments.length
  };
}


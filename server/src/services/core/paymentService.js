import { PaymentStatus, TransactionPaymentStatus } from "@prisma/client";
import { TransactionError } from "./errors.js";

export const COMPLETED_PAYMENT_STATUSES = [
  PaymentStatus.CAPTURED,
  PaymentStatus.COMPLETED,
  PaymentStatus.AUTHORIZED
];

export const REFUNDED_PAYMENT_STATUSES = [PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED];

export const PAYMENT_STATUS_TRANSITIONS = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.FAILED,
    PaymentStatus.VOIDED
  ],
  [PaymentStatus.AUTHORIZED]: [PaymentStatus.COMPLETED, PaymentStatus.FAILED, PaymentStatus.VOIDED],
  [PaymentStatus.CAPTURED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
    PaymentStatus.VOIDED
  ],
  [PaymentStatus.COMPLETED]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
    PaymentStatus.VOIDED
  ],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUNDED, PaymentStatus.VOIDED],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.FAILED]: [PaymentStatus.VOIDED],
  [PaymentStatus.VOIDED]: []
};

export function isPaymentSettledStatus(status) {
  return COMPLETED_PAYMENT_STATUSES.includes(status);
}

export function isPaymentRefundableStatus(status) {
  return [PaymentStatus.CAPTURED, PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED].includes(status);
}

export function isPaymentTerminalStatus(status) {
  return status === PaymentStatus.VOIDED || status === PaymentStatus.REFUNDED || status === PaymentStatus.FAILED;
}

export function assertPaymentStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    throw new TransactionError("INVALID_PAYMENT_STATE", "payment already has that status", 409);
  }

  const allowed = PAYMENT_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw new TransactionError(
      "INVALID_PAYMENT_STATE",
      `cannot transition payment from ${currentStatus} to ${nextStatus}`,
      409
    );
  }
}

export function sumCapturedPaymentCents(payments) {
  return payments.reduce((total, payment) => {
    if (!isPaymentSettledStatus(payment.status)) {
      return total;
    }

    const captured = Number(payment.capturedAmountCents ?? payment.amountCents ?? 0);
    const refunded = Number(payment.refundedAmountCents ?? 0);
    return total + Math.max(0, captured - refunded);
  }, 0);
}

export function sumRefundedPaymentCents(payments) {
  return payments.reduce((total, payment) => total + Number(payment.refundedAmountCents ?? 0), 0);
}

export function resolveTransactionPaymentStatus(totalCents, capturedCents) {
  if (capturedCents >= totalCents) {
    return TransactionPaymentStatus.PAID;
  }

  if (capturedCents > 0) {
    return TransactionPaymentStatus.PARTIALLY_PAID;
  }

  return TransactionPaymentStatus.PENDING;
}

export function resolveTransactionPaymentStatusFromPayments(totalCents, payments, transactionStatus = null) {
  const captured = sumCapturedPaymentCents(payments);
  const refunded = sumRefundedPaymentCents(payments);

  if (totalCents === 0 && transactionStatus === TransactionPaymentStatus.REFUNDED) {
    return TransactionPaymentStatus.REFUNDED;
  }

  if (refunded > 0 && refunded >= totalCents) {
    return TransactionPaymentStatus.REFUNDED;
  }

  return resolveTransactionPaymentStatus(totalCents, captured);
}

export function assertAmountCoversRefundedAmount(totalRef, alreadyRefunded, requested) {
  if (requested > totalRef - alreadyRefunded) {
    throw new TransactionError("OVER_REFUND", "refund exceeds paid balance", 409);
  }
}

export function paymentSettledStatusesForQuery() {
  return COMPLETED_PAYMENT_STATUSES;
}

export function hasRemainingPayment(totalCents, capturedCents) {
  return Math.max(0, totalCents - (capturedCents || 0));
}

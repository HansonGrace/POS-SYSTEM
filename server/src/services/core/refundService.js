import { TransactionError } from "./errors.js";

export function calculateRemainingTransactionRefund(totalCents, refundedCents) {
  return Math.max(0, totalCents - refundedCents);
}

export function calculateRemainingLineRefund(lineTotalCents, refundedLineCents) {
  return Math.max(0, lineTotalCents - refundedLineCents);
}

export function assertRefundWithinLimit(requestedCents, refundableCents) {
  if (requestedCents > refundableCents) {
    throw new TransactionError("OVER_REFUND", "refund exceeds refundable amount", 409);
  }
}


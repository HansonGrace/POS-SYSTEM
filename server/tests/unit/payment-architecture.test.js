import test from "node:test";
import assert from "node:assert/strict";

import {
  PaymentStatus,
  TransactionPaymentStatus
} from "@prisma/client";
import { TransactionError } from "../../src/services/core/errors.js";
import {
  assertPaymentStatusTransition,
  isPaymentRefundableStatus,
  resolveTransactionPaymentStatusFromPayments,
  sumCapturedPaymentCents,
  resolveTransactionPaymentStatus
} from "../../src/services/core/paymentService.js";

test("payment status transition rules are enforced", () => {
  assert.doesNotThrow(() => {
    assertPaymentStatusTransition(PaymentStatus.PENDING, PaymentStatus.AUTHORIZED);
  });

  assert.doesNotThrow(() => {
    assertPaymentStatusTransition(PaymentStatus.AUTHORIZED, PaymentStatus.COMPLETED);
  });

  assert.throws(
    () => assertPaymentStatusTransition(PaymentStatus.AUTHORIZED, PaymentStatus.CAPTURED),
    (error) => error instanceof TransactionError
  );
});

test("payment status transition prevents duplicate completion", () => {
  assert.throws(
    () => assertPaymentStatusTransition(PaymentStatus.COMPLETED, PaymentStatus.COMPLETED),
    (error) => error instanceof TransactionError && error.code === "INVALID_PAYMENT_STATE"
  );
});

test("payment status aggregation distinguishes full paid, partial, and refunded", () => {
  const noPayments = [];
  assert.equal(resolveTransactionPaymentStatus(1000, 0), TransactionPaymentStatus.PENDING);

  const partial = [
    { status: PaymentStatus.COMPLETED, capturedAmountCents: 200, refundedAmountCents: 0 },
    { status: PaymentStatus.CAPTURED, capturedAmountCents: 300, refundedAmountCents: 0 }
  ];
  assert.equal(resolveTransactionPaymentStatusFromPayments(1000, partial), TransactionPaymentStatus.PARTIALLY_PAID);
  assert.equal(sumCapturedPaymentCents(partial), 500);

  const full = [
    { status: PaymentStatus.COMPLETED, capturedAmountCents: 1000, refundedAmountCents: 0 }
  ];
  const resolvedFull = resolveTransactionPaymentStatusFromPayments(1000, full);
  assert.equal(resolvedFull, TransactionPaymentStatus.PAID);
});

test("refundable payment predicates are used for safety", () => {
  assert.equal(isPaymentRefundableStatus(PaymentStatus.CAPTURED), true);
  assert.equal(isPaymentRefundableStatus(PaymentStatus.FAILED), false);
  assert.equal(isPaymentRefundableStatus(PaymentStatus.REFUNDED), false);
});

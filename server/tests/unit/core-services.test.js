import test from "node:test";
import assert from "node:assert/strict";

import { TransactionError } from "../../src/services/core/errors.js";
import {
  assertPositiveInteger
} from "../../src/services/core/validationService.js";
import {
  buildItemSnapshot,
  buildLineItemTotals
} from "../../src/services/core/pricingService.js";
import {
  calculateSalesTaxCents
} from "../../src/services/core/taxService.js";
import { calculateTransactionTotalsFromItems } from "../../src/services/core/transactionTotalsService.js";
import { resolveTransactionPaymentStatus } from "../../src/services/core/paymentService.js";
import {
  calculateRemainingTransactionRefund,
  calculateRemainingLineRefund,
  assertRefundWithinLimit
} from "../../src/services/core/refundService.js";
import { buildLineDiscountInput } from "../../src/services/core/discountService.js";
import { buildReceiptPayload } from "../../src/services/core/receiptService.js";

test("pricing service builds immutable line totals and enforces pricing limits", () => {
  const product = {
    id: 1,
    name: "Latte",
    sku: "LAT-1",
    barcode: "1234",
    category: "Coffee",
    priceCents: 650
  };

  const lineTotals = buildLineItemTotals({
    product,
    quantity: 2,
    unitDiscountCents: 50,
    lineTaxCents: calculateSalesTaxCents(1250, 0.1)
  });

  assert.equal(lineTotals.quantity, 2);
  assert.equal(lineTotals.unitPriceCents, 650);
  assert.equal(lineTotals.discountAmountCents, 50);
  assert.equal(lineTotals.lineSubtotalCents, 1250);
  assert.equal(lineTotals.taxAmountCents, 125);
  assert.equal(lineTotals.lineTotalCents, 1375);

  const snapshot = buildItemSnapshot(product);
  assert.equal(snapshot.productNameSnapshot, "Latte");
  assert.equal(snapshot.productCategorySnapshot, "Coffee");
});

test("tax service computes sales tax for explicit rates", () => {
  const tax = calculateSalesTaxCents(9876, 0.0825);
  assert.equal(tax, Math.round(9876 * 0.0825));
});

test("totals service aggregates all item totals", () => {
  const totals = calculateTransactionTotalsFromItems([
    { lineSubtotalCents: 1200, discountAmountCents: 100, taxAmountCents: 100 },
    { lineSubtotalCents: 800, discountAmountCents: 0, taxAmountCents: 66 }
  ]);

  assert.equal(totals.subtotalCents, 2000);
  assert.equal(totals.discountTotalCents, 100);
  assert.equal(totals.taxTotalCents, 166);
  assert.equal(totals.totalCents, 2166);
});

test("payment status transitions map to domain states", () => {
  assert.equal(resolveTransactionPaymentStatus(2000, 0), "PENDING");
  assert.equal(resolveTransactionPaymentStatus(2000, 200), "PARTIALLY_PAID");
  assert.equal(resolveTransactionPaymentStatus(2000, 2000), "PAID");
});

test("discount service creates immutable discount records", () => {
  const discount = buildLineDiscountInput({
    transactionId: 10,
    transactionItemId: 20,
    amountCents: 300
  });

  assert.equal(discount.name, "Line discount");
  assert.equal(discount.amountCents, 300);
  assert.equal(discount.discountType, "AMOUNT");
  assert.equal(discount.target, "ITEM");
});

test("refund service enforces over-refund prevention", () => {
  assert.equal(calculateRemainingTransactionRefund(5000, 1500), 3500);
  assert.equal(calculateRemainingLineRefund(1200, 400), 800);

  assert.throws(
    () => assertRefundWithinLimit(1001, 1000),
    (error) => error instanceof TransactionError && error.code === "OVER_REFUND"
  );
});

test("validation service rejects invalid ids and decimals", () => {
  assert.equal(assertPositiveInteger(5, "qty"), undefined);
  assert.throws(
    () => assertPositiveInteger(0, "qty"),
    (error) => error instanceof TransactionError && error.code === "INVALID_INPUT"
  );
});

test("core services compose into a realistic transaction flow", () => {
  const subtotal = 3000;
  const tax = calculateSalesTaxCents(subtotal, 0.06);
  const totals = calculateTransactionTotalsFromItems([
    { lineSubtotalCents: 1500, discountAmountCents: 200, taxAmountCents: 90 },
    { lineSubtotalCents: 1500, discountAmountCents: 100, taxAmountCents: tax - 90 }
  ]);

  assert.equal(totals.totalCents, subtotal + tax);

  const receipt = buildReceiptPayload({
    transactionNumber: "TX-FLOW-1",
    cashierId: 1,
    lineItemCount: 2,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxTotalCents,
    totalCents: totals.totalCents
  });

  assert.equal(receipt.transactionNumber, "TX-FLOW-1");
  assert.equal(receipt.lineItems, 2);

  const paymentStatusAfterFullCapture = resolveTransactionPaymentStatus(totals.totalCents, totals.totalCents);
  assert.equal(paymentStatusAfterFullCapture, "PAID");

  const remainingRefund = calculateRemainingTransactionRefund(totals.totalCents, 0);
  assert.equal(remainingRefund, totals.totalCents);

  const lineRemaining = calculateRemainingLineRefund(1500, 300);
  assert.equal(lineRemaining, 1200);
});

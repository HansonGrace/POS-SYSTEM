import { DiscountTarget, DiscountType } from "@prisma/client";

export const DEFAULT_LINE_DISCOUNT_NAME = "Line discount";

export function buildLineDiscountInput({ transactionId, transactionItemId, amountCents }) {
  return {
    transactionId,
    transactionItemId,
    name: DEFAULT_LINE_DISCOUNT_NAME,
    discountType: DiscountType.AMOUNT,
    target: DiscountTarget.ITEM,
    amountCents
  };
}


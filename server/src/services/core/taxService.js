import { TransactionTaxType } from "@prisma/client";
import { computeTax } from "../../utils/money.js";
import { config } from "../../config.js";

const TAX_NAME = "Sales Tax";

export function getSalesTaxBasisPoints() {
  return Math.max(0, Math.round(config.taxRate * 10000));
}

export function calculateSalesTaxCents(subtotalCents, taxRate = config.taxRate) {
  return computeTax(subtotalCents, taxRate);
}

export function buildSalesTaxRecordInput({ transactionId, taxableAmountCents, amountCents }) {
  return {
    transactionId,
    name: TAX_NAME,
    taxType: TransactionTaxType.SALES,
    rateBasisPoints: getSalesTaxBasisPoints(),
    taxableAmountCents,
    amountCents
  };
}

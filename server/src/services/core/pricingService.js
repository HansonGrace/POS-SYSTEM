import { TransactionError } from "./errors.js";

export async function resolveProductsForItems(tx, productIds) {
  if (!productIds.length) {
    return [];
  }

  return tx.product.findMany({
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
      priceCents: true
    }
  });
}

export function buildItemSnapshot(product) {
  return {
    productNameSnapshot: product.name,
    productSkuSnapshot: product.sku,
    productBarcodeSnapshot: product.barcode,
    productCategorySnapshot: product.category
  };
}

export function buildLineItemTotals({ product, quantity, unitDiscountCents = 0, lineTaxCents = 0 }) {
  if (!product) {
    throw new TransactionError("INVALID_INPUT", "line item product is required", 400);
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new TransactionError("INVALID_INPUT", "quantity must be a positive integer", 400);
  }

  if (!Number.isInteger(unitDiscountCents) || unitDiscountCents < 0) {
    throw new TransactionError("INVALID_INPUT", "discount must be a non-negative integer", 400);
  }

  const lineSubtotalCents = product.priceCents * quantity - unitDiscountCents;
  if (lineSubtotalCents < 0) {
    throw new TransactionError("INVALID_INPUT", "line discount can not exceed line value", 400);
  }

  if (!Number.isInteger(lineTaxCents) || lineTaxCents < 0) {
    throw new TransactionError("INVALID_INPUT", "tax amount must be zero or greater", 400);
  }

  return {
    quantity,
    unitPriceCents: product.priceCents,
    discountAmountCents: unitDiscountCents,
    lineSubtotalCents,
    lineTotalCents: lineSubtotalCents + lineTaxCents,
    taxAmountCents: lineTaxCents
  };
}

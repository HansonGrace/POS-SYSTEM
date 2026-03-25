export function calculateTransactionTotalsFromItems(items) {
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


export function buildReceiptPayload({
  transactionNumber,
  cashierId,
  lineItemCount,
  subtotalCents,
  taxCents,
  totalCents
}) {
  return {
    transactionNumber,
    cashierId,
    lineItems: lineItemCount,
    subtotalCents,
    taxCents,
    totalCents
  };
}

export function dollarsToCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed * 100);
}

export function centsToDollars(cents) {
  return (cents / 100).toFixed(2);
}

export function computeTax(subtotalCents, taxRate) {
  return Math.round(subtotalCents * taxRate);
}

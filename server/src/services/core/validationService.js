import { TransactionError } from "./errors.js";

export function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TransactionError("INVALID_INPUT", `${name} must be a positive integer`, 400);
  }
}

export function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TransactionError(
      "INVALID_INPUT",
      `${name} must be a non-negative integer`,
      400
    );
  }
}

export function assertRequiredId(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TransactionError("INVALID_INPUT", `${name} must be a valid positive id`, 400);
  }
}

export function assertPositiveNumber(value, name, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : Number.EPSILON;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new TransactionError("INVALID_INPUT", `${name} must be a positive number`, 400);
  }
}

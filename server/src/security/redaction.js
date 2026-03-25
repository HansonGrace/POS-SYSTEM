import { config } from "../config.js";

const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|cookie|session|card|cvv|pin)/i;
const REDACTED = "[REDACTED]";

export function redactPaymentMethod(paymentMethod) {
  if (!paymentMethod) {
    return null;
  }

  return {
    id: paymentMethod.id,
    brand: paymentMethod.brand,
    last4: paymentMethod.last4,
    expMonth: paymentMethod.expMonth,
    expYear: paymentMethod.expYear,
    createdAt: paymentMethod.createdAt
  };
}

export function canExposeTokens({ includeTokens }) {
  return config.labMode && config.exposePaymentTokens && includeTokens;
}

export function redactSensitiveFields(value, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 4) {
    return "[TRUNCATED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item, depth + 1));
  }

  if (typeof value !== "object") {
    return value;
  }

  const output = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
      continue;
    }
    output[key] = redactSensitiveFields(nestedValue, depth + 1);
  }

  return output;
}

export function redactCustomer(customer, options = {}) {
  const includePaymentMethods = Boolean(options.includePaymentMethods);
  const includeTokens = canExposeTokens({ includeTokens: Boolean(options.includeTokens) });

  const redacted = {
    id: customer.id,
    name: customer.name,
    email: customer.email ?? null,
    phone: customer.phone ?? null,
    createdAt: customer.createdAt
  };

  if (includePaymentMethods) {
    redacted.paymentMethods = (customer.paymentMethods || []).map((paymentMethod) => {
      if (includeTokens) {
        return {
          ...redactPaymentMethod(paymentMethod),
          token: paymentMethod.token
        };
      }
      return redactPaymentMethod(paymentMethod);
    });
  }

  return redacted;
}

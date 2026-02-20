import { config } from "../config.js";

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

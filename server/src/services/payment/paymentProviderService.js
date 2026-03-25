import { randomUUID } from "node:crypto";
import { PaymentStatus, TenderType } from "@prisma/client";

function generateProviderReference(providerCode) {
  return `${providerCode}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function buildFailureResult(provider, message, code = "provider_declined") {
  return {
    status: PaymentStatus.FAILED,
    providerReference: generateProviderReference(provider),
    errorCode: code,
    errorMessage: message
  };
}

function buildSuccessResult(provider, status, amountCents) {
  return {
    status,
    providerReference: generateProviderReference(provider),
    capturedAmountCents: amountCents,
    refundedAmountCents: 0
  };
}

function isCardDeclineReference(reference, metadata = {}) {
  return (
    String(reference || "").toLowerCase().startsWith("decline") ||
    String(metadata?.result || "").toLowerCase() === "decline"
  );
}

const cashProvider = {
  name: "cash",
  async authorize({ amountCents, reference }) {
    if (amountCents <= 0) {
      return buildFailureResult(this.name, "invalid amount for cash authorization");
    }

    return buildSuccessResult(this.name, PaymentStatus.AUTHORIZED, 0);
  },
  async capture({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.COMPLETED, amountCents);
  },
  async refund({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.REFUNDED, amountCents);
  },
  async void() {
    return {
      status: PaymentStatus.VOIDED,
      providerReference: generateProviderReference(this.name)
    };
  }
};

const cardProvider = {
  name: "card",
  async authorize({ amountCents, reference, metadata }) {
    if (isCardDeclineReference(reference, metadata)) {
      return buildFailureResult(this.name, "card payment was declined", "card_declined");
    }

    if (amountCents <= 0) {
      return buildFailureResult(this.name, "invalid amount for card authorization");
    }

    return buildSuccessResult(this.name, PaymentStatus.AUTHORIZED, 0);
  },
  async capture({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.COMPLETED, amountCents);
  },
  async refund({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.REFUNDED, amountCents);
  },
  async void() {
    return {
      status: PaymentStatus.VOIDED,
      providerReference: generateProviderReference(this.name)
    };
  }
};

const giftCardProvider = {
  name: "gift_card",
  async authorize({ amountCents, reference, metadata }) {
    if (!metadata?.giftCardId && !(reference || "").trim()) {
      return buildFailureResult(this.name, "gift card reference required");
    }

    if (amountCents <= 0) {
      return buildFailureResult(this.name, "invalid amount for gift card authorization");
    }

    return buildSuccessResult(this.name, PaymentStatus.AUTHORIZED, 0);
  },
  async capture({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.COMPLETED, amountCents);
  },
  async refund({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.REFUNDED, amountCents);
  },
  async void() {
    return {
      status: PaymentStatus.VOIDED,
      providerReference: generateProviderReference(this.name)
    };
  }
};

const digitalWalletProvider = {
  name: "digital_wallet",
  async authorize({ amountCents, reference, metadata }) {
    if (isCardDeclineReference(reference, metadata)) {
      return buildFailureResult(this.name, "digital wallet payment was declined", "wallet_declined");
    }

    if (amountCents <= 0) {
      return buildFailureResult(this.name, "invalid amount for digital wallet authorization");
    }

    return buildSuccessResult(this.name, PaymentStatus.AUTHORIZED, 0);
  },
  async capture({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.COMPLETED, amountCents);
  },
  async refund({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.REFUNDED, amountCents);
  },
  async void() {
    return {
      status: PaymentStatus.VOIDED,
      providerReference: generateProviderReference(this.name)
    };
  }
};

const otherProvider = {
  name: "manual_tender",
  async authorize({ amountCents }) {
    if (amountCents <= 0) {
      return buildFailureResult(this.name, "invalid amount for manual tender");
    }

    return buildSuccessResult(this.name, PaymentStatus.AUTHORIZED, 0);
  },
  async capture({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.COMPLETED, amountCents);
  },
  async refund({ amountCents }) {
    return buildSuccessResult(this.name, PaymentStatus.REFUNDED, amountCents);
  },
  async void() {
    return {
      status: PaymentStatus.VOIDED,
      providerReference: generateProviderReference(this.name)
    };
  }
};

const providerMap = {
  [TenderType.CASH]: cashProvider,
  [TenderType.CARD]: cardProvider,
  [TenderType.GIFT_CARD]: giftCardProvider,
  [TenderType.DIGITAL_WALLET]: digitalWalletProvider,
  [TenderType.OTHER]: otherProvider
};

export function resolvePaymentProvider(tenderType) {
  return providerMap[tenderType];
}


import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

export function assertWeakPaymentTokenModeEnabled() {
  if (config.paymentTokenMode === "weak" && (!config.labMode || !config.allowWeakPaymentTokens)) {
    throw new Error(
      "Weak payment token mode is disabled. Set LAB_MODE=true and ALLOW_WEAK_PAYMENT_TOKENS=true for intentional lab scenarios."
    );
  }
}

export function generatePaymentToken(seed = "") {
  if (config.paymentTokenMode === "weak") {
    assertWeakPaymentTokenModeEnabled();

    // Controlled cyber-lab simulation only. Weak token mode must be explicitly enabled via config
    // and must never be used with production credentials.
    const predictable = `${Date.now()}:${seed}`;
    const tokenSuffix = createHash("md5").update(predictable).digest("hex").slice(0, 16);
    return `pm_tok_weak_${tokenSuffix}`;
  }

  return `pm_tok_${randomBytes(16).toString("hex")}`;
}

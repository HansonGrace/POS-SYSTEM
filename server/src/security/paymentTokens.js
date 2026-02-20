import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

export function generatePaymentToken(seed = "") {
  if (config.paymentTokenMode === "weak" && config.labMode) {
    const predictable = `${Date.now()}:${seed}`;
    const tokenSuffix = createHash("md5").update(predictable).digest("hex").slice(0, 16);
    return `pm_tok_weak_${tokenSuffix}`;
  }

  return `pm_tok_${randomBytes(16).toString("hex")}`;
}

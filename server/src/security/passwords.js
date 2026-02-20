import { config } from "../config.js";

export function isPasswordAllowed(password) {
  if (config.labMode && config.weakPasswordsAllowed) {
    return true;
  }

  return String(password || "").length >= config.passwordMinLength;
}

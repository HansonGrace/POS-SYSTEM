const DEFAULTS = {
  minPasswordLength: 12,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  resetTokenMinutes: 15,
  argon2Profile: "baseline"
};

const ARGON2_PROFILES = {
  baseline: {
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32
  },
  high: {
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32
  }
};

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(overrides = {}) {
  const env = process.env;
  const selectedProfile =
    overrides.argon2Profile ?? env.ARGON2_PROFILE ?? DEFAULTS.argon2Profile;
  const baseProfile = ARGON2_PROFILES[selectedProfile] ?? ARGON2_PROFILES.baseline;

  return {
    pepper: overrides.pepper ?? env.PASSWORD_PEPPER ?? "",
    minPasswordLength: parseNumber(
      overrides.minPasswordLength ?? env.MIN_PASSWORD_LENGTH,
      DEFAULTS.minPasswordLength
    ),
    maxFailedAttempts: parseNumber(
      overrides.maxFailedAttempts ?? env.MAX_FAILED_ATTEMPTS,
      DEFAULTS.maxFailedAttempts
    ),
    lockoutMinutes: parseNumber(
      overrides.lockoutMinutes ?? env.LOCKOUT_MINUTES,
      DEFAULTS.lockoutMinutes
    ),
    resetTokenMinutes: parseNumber(
      overrides.resetTokenMinutes ?? env.RESET_TOKEN_MINUTES,
      DEFAULTS.resetTokenMinutes
    ),
    argon2: {
      memoryCost: parseNumber(
        overrides.argon2?.memoryCost ?? env.ARGON2_MEMORY_KIB,
        baseProfile.memoryCost
      ),
      timeCost: parseNumber(
        overrides.argon2?.timeCost ?? env.ARGON2_TIME_COST,
        baseProfile.timeCost
      ),
      parallelism: parseNumber(
        overrides.argon2?.parallelism ?? env.ARGON2_PARALLELISM,
        baseProfile.parallelism
      ),
      hashLength: parseNumber(
        overrides.argon2?.hashLength ?? env.ARGON2_HASH_LENGTH,
        baseProfile.hashLength
      )
    }
  };
}


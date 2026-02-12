import crypto from "node:crypto";
import { readConfig } from "./config.js";
import { InMemoryUserStore } from "./store/inMemoryUserStore.js";
import {
  createLegacyHashForTests,
  hashArgon2id,
  verifyArgon2id,
  verifyLegacy
} from "./passwords.js";

const GENERIC_AUTH_ERROR = "Invalid username or password.";

function nowMs() {
  return Date.now();
}

function normalizeUsername(username) {
  return String(username ?? "").trim().toLowerCase();
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createDefaultLogger() {
  return {
    info(event, metadata = {}) {
      console.info("[auth]", event, metadata);
    },
    warn(event, metadata = {}) {
      console.warn("[auth]", event, metadata);
    }
  };
}

export class AuthService {
  constructor(options = {}) {
    this.config = readConfig(options.config ?? options);
    this.userStore = options.userStore ?? new InMemoryUserStore();
    this.logger = options.logger ?? createDefaultLogger();
    this.passwordDenylistCheck = options.passwordDenylistCheck ?? null;
  }

  async create_user(username, plaintext_password) {
    const normalizedUsername = normalizeUsername(username);
    this.#validateUsername(normalizedUsername);
    await this.#validatePasswordPolicy(normalizedUsername, plaintext_password);

    const password_hash = await hashArgon2id(plaintext_password, this.config);

    try {
      const created = await this.userStore.createUser({
        username: normalizedUsername,
        password_hash,
        password_algo: "argon2id"
      });

      this.logger.info("auth.user.created", { username: normalizedUsername });
      return { id: created.id, username: created.username };
    } catch (error) {
      if (error instanceof Error && error.message === "USERNAME_TAKEN") {
        throw new Error("Username already exists.");
      }
      throw error;
    }
  }

  async verify_login(username, plaintext_password) {
    const normalizedUsername = normalizeUsername(username);
    const user = await this.userStore.findByUsername(normalizedUsername);
    if (!user) {
      this.logger.warn("auth.login.failed", {
        username: normalizedUsername,
        reason: "invalid_credentials"
      });
      return { ok: false, error: GENERIC_AUTH_ERROR };
    }

    if (this.#isLocked(user)) {
      this.logger.warn("auth.login.failed", {
        username: normalizedUsername,
        reason: "account_locked"
      });
      return { ok: false, error: GENERIC_AUTH_ERROR };
    }

    const verified = await this.#verifyPasswordForUser(user, plaintext_password);
    if (!verified) {
      await this.#registerFailedAttempt(user);
      this.logger.warn("auth.login.failed", {
        username: normalizedUsername,
        reason: "invalid_credentials"
      });
      return { ok: false, error: GENERIC_AUTH_ERROR };
    }

    await this.userStore.updateUser(user.id, {
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString()
    });

    this.logger.info("auth.login.success", { username: normalizedUsername });
    return { ok: true, user: { id: user.id, username: user.username } };
  }

  async change_password(username, old_password, new_password) {
    const normalizedUsername = normalizeUsername(username);
    const login = await this.verify_login(normalizedUsername, old_password);
    if (!login.ok) {
      return { ok: false, error: GENERIC_AUTH_ERROR };
    }

    await this.#validatePasswordPolicy(normalizedUsername, new_password);
    const newHash = await hashArgon2id(new_password, this.config);
    await this.userStore.updateUser(login.user.id, {
      password_hash: newHash,
      password_algo: "argon2id",
      failed_attempts: 0,
      locked_until: null
    });

    this.logger.info("auth.password.changed", { username: normalizedUsername });
    return { ok: true };
  }

  async issue_reset_token(username) {
    const normalizedUsername = normalizeUsername(username);
    const user = await this.userStore.findByUsername(normalizedUsername);
    if (!user) {
      return null;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const expiresAtIso = new Date(
      nowMs() + this.config.resetTokenMinutes * 60 * 1000
    ).toISOString();

    await this.userStore.updateUser(user.id, {
      reset_token_hash: tokenHash,
      reset_token_expires_at: expiresAtIso
    });

    this.logger.info("auth.password.reset_token_issued", {
      username: normalizedUsername
    });

    return token;
  }

  async reset_password(token, new_password) {
    const tokenHash = hashResetToken(String(token ?? ""));
    const user = await this.userStore.findByResetTokenHash(tokenHash);
    if (!user || !user.reset_token_expires_at) {
      return { ok: false, error: GENERIC_AUTH_ERROR };
    }

    const expiresAtMs = new Date(user.reset_token_expires_at).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs()) {
      return { ok: false, error: GENERIC_AUTH_ERROR };
    }

    await this.#validatePasswordPolicy(user.username, new_password);
    const password_hash = await hashArgon2id(new_password, this.config);

    await this.userStore.updateUser(user.id, {
      password_hash,
      password_algo: "argon2id",
      failed_attempts: 0,
      locked_until: null,
      reset_token_hash: null,
      reset_token_expires_at: null
    });

    this.logger.info("auth.password.reset", { username: user.username });
    return { ok: true };
  }

  async create_regular_users_1_to_10() {
    const created = [];
    for (let i = 1; i <= 10; i += 1) {
      const username = `user${i}`;
      const password = `user${i}`;
      const existing = await this.userStore.findByUsername(username);
      if (existing) {
        continue;
      }
      const user = await this.create_user(username, password);
      created.push(user);
    }
    return created;
  }

  async #verifyPasswordForUser(user, plaintextPassword) {
    if (user.password_algo === "argon2id") {
      return verifyArgon2id(user.password_hash, plaintextPassword, this.config);
    }

    const legacyVerified = await verifyLegacy(
      user.password_hash,
      user.password_algo,
      plaintextPassword,
      this.config
    );

    if (!legacyVerified) {
      return false;
    }

    const upgradedHash = await hashArgon2id(plaintextPassword, this.config);
    await this.userStore.updateUser(user.id, {
      password_hash: upgradedHash,
      password_algo: "argon2id"
    });

    this.logger.info("auth.password.migrated", {
      username: user.username,
      from: user.password_algo,
      to: "argon2id"
    });
    return true;
  }

  async #registerFailedAttempt(user) {
    const attempts = Number(user.failed_attempts ?? 0) + 1;
    const shouldLock = attempts >= this.config.maxFailedAttempts;

    await this.userStore.updateUser(user.id, {
      failed_attempts: attempts,
      locked_until: shouldLock
        ? new Date(nowMs() + this.config.lockoutMinutes * 60 * 1000).toISOString()
        : null
    });
  }

  #isLocked(user) {
    if (!user.locked_until) {
      return false;
    }
    const lockedUntil = new Date(user.locked_until).getTime();
    return Number.isFinite(lockedUntil) && lockedUntil > nowMs();
  }

  #validateUsername(username) {
    if (!username) {
      throw new Error("Username is required.");
    }
  }

  async #validatePasswordPolicy(username, password) {
    const rawPassword = String(password ?? "");
    if (rawPassword.length < this.config.minPasswordLength) {
      throw new Error(
        `Password must be at least ${this.config.minPasswordLength} characters.`
      );
    }

    if (this.passwordDenylistCheck) {
      const denied = await this.passwordDenylistCheck(rawPassword, username);
      if (denied) {
        throw new Error("Password is not allowed.");
      }
    }
  }
}

export function createAuthService(options = {}) {
  return new AuthService(options);
}

export { InMemoryUserStore, createLegacyHashForTests };

const defaultAuthService = createAuthService();

export async function create_user(username, plaintext_password) {
  return defaultAuthService.create_user(username, plaintext_password);
}

export async function verify_login(username, plaintext_password) {
  return defaultAuthService.verify_login(username, plaintext_password);
}

export async function change_password(username, old_password, new_password) {
  return defaultAuthService.change_password(username, old_password, new_password);
}

export async function reset_password(token, new_password) {
  return defaultAuthService.reset_password(token, new_password);
}

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

function numberFromEnv(schema) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    return Number(value);
  }, schema);
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "lab", "production"]).default("development"),
  LAB_MODE: booleanFromEnv.default(false),
  LAB_PROFILE: z
    .enum(["secure", "scenario_credential_stuffing", "scenario_data_exposure"])
    .default("secure"),
  SESSION_SECRET: z.string().trim().min(1).optional(),
  SESSION_NAME: z.string().trim().min(1).default("pos_sid"),
  TRUST_PROXY: booleanFromEnv.default(false),
  API_HOST: z.string().trim().min(1).default("0.0.0.0"),
  API_PORT: numberFromEnv(z.number().int().positive()).default(4000),
  CORS_ORIGINS: z.string().trim().min(1).default("http://localhost:5173"),
  COOKIE_SECURE: booleanFromEnv.optional(),
  CSRF_ENABLED: booleanFromEnv.default(true),
  RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  LOCKOUT_ENABLED: booleanFromEnv.default(true),
  WEAK_PASSWORDS_ALLOWED: booleanFromEnv.default(false),
  PASSWORD_MIN_LENGTH: numberFromEnv(z.number().int().min(1)).default(10),
  PAYMENT_TOKEN_MODE: z.enum(["strong", "weak"]).default("strong"),
  EXPOSE_PAYMENT_TOKENS: booleanFromEnv.default(false),
  SIEM_MODE: z.enum(["off", "syslog", "http"]).default("off"),
  SYSLOG_HOST: z.string().trim().optional(),
  SYSLOG_PORT: numberFromEnv(z.number().int().min(1).max(65535)).default(514),
  SIEM_HTTP_URL: z.string().trim().url().optional(),
  SIEM_HTTP_API_KEY: z.string().trim().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_PROVIDER: z.enum(["sqlite", "postgresql"]).default("sqlite"),
  DATABASE_URL: z.string().trim().min(1).default("file:./dev.db"),
  TAX_RATE: numberFromEnv(z.number().min(0).max(1)).default(0.0825),
  VOID_WINDOW_MINUTES: numberFromEnv(z.number().int().positive()).default(30),
  SEED_LAB_USERS: booleanFromEnv.default(false),
  LOCKOUT_THRESHOLD: numberFromEnv(z.number().int().min(1).max(20)).default(5),
  LOCKOUT_MINUTES: numberFromEnv(z.number().int().min(1).max(240)).default(15)
});

const profileOverrides = {
  secure: {},
  scenario_credential_stuffing: {
    rateLimitEnabled: false,
    lockoutEnabled: false,
    weakPasswordsAllowed: true,
    paymentTokenMode: "weak"
  },
  scenario_data_exposure: {
    exposePaymentTokens: true,
    paymentTokenMode: "weak"
  }
};

const parsed = envSchema.parse(process.env);
const warnings = [];

if (!parsed.LAB_MODE && parsed.LAB_PROFILE !== "secure") {
  warnings.push("LAB_PROFILE ignored because LAB_MODE is false.");
}

const effectiveProfile = parsed.LAB_MODE ? parsed.LAB_PROFILE : "secure";
const overrides = parsed.LAB_MODE ? profileOverrides[effectiveProfile] : {};

const sessionSecret =
  parsed.SESSION_SECRET || (parsed.LAB_MODE ? "lab-insecure-session-secret" : undefined);

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required unless LAB_MODE=true.");
}

if (!parsed.SESSION_SECRET && parsed.LAB_MODE) {
  warnings.push("SESSION_SECRET not set. Using lab fallback secret.");
}

const corsOrigins = parsed.CORS_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (corsOrigins.includes("*")) {
  throw new Error("CORS_ORIGINS cannot contain '*' when credentialed cookies are enabled.");
}

const exposePaymentTokens = overrides.exposePaymentTokens ?? parsed.EXPOSE_PAYMENT_TOKENS;
if (exposePaymentTokens && !parsed.LAB_MODE) {
  throw new Error("EXPOSE_PAYMENT_TOKENS=true is only allowed when LAB_MODE=true.");
}
if (exposePaymentTokens) {
  warnings.push("EXPOSE_PAYMENT_TOKENS is enabled. Sensitive token data may be returned.");
}

if (parsed.SIEM_MODE === "syslog" && !parsed.SYSLOG_HOST) {
  warnings.push("SIEM_MODE=syslog but SYSLOG_HOST is not configured. SIEM forwarding will be skipped.");
}
if (parsed.SIEM_MODE === "http" && !parsed.SIEM_HTTP_URL) {
  warnings.push("SIEM_MODE=http but SIEM_HTTP_URL is not configured. SIEM forwarding will be skipped.");
}

export const config = {
  nodeEnv: parsed.NODE_ENV,
  labMode: parsed.LAB_MODE,
  labProfile: effectiveProfile,
  sessionSecret,
  sessionName: parsed.SESSION_NAME,
  trustProxy: parsed.TRUST_PROXY,
  host: parsed.API_HOST,
  port: parsed.API_PORT,
  corsOrigins,
  cookieSecure:
    parsed.COOKIE_SECURE !== undefined ? parsed.COOKIE_SECURE : parsed.NODE_ENV === "production",
  csrfEnabled: parsed.CSRF_ENABLED,
  rateLimitEnabled: overrides.rateLimitEnabled ?? parsed.RATE_LIMIT_ENABLED,
  lockoutEnabled: overrides.lockoutEnabled ?? parsed.LOCKOUT_ENABLED,
  weakPasswordsAllowed: overrides.weakPasswordsAllowed ?? parsed.WEAK_PASSWORDS_ALLOWED,
  passwordMinLength: parsed.PASSWORD_MIN_LENGTH,
  paymentTokenMode: overrides.paymentTokenMode ?? parsed.PAYMENT_TOKEN_MODE,
  exposePaymentTokens,
  siemMode: parsed.SIEM_MODE,
  syslogHost: parsed.SYSLOG_HOST,
  syslogPort: parsed.SYSLOG_PORT,
  siemHttpUrl: parsed.SIEM_HTTP_URL,
  siemHttpApiKey: parsed.SIEM_HTTP_API_KEY,
  logLevel: parsed.LOG_LEVEL,
  databaseUrl: parsed.DATABASE_URL,
  databaseProvider: parsed.DATABASE_PROVIDER,
  taxRate: parsed.TAX_RATE,
  voidWindowMinutes: parsed.VOID_WINDOW_MINUTES,
  seedLabUsers: parsed.SEED_LAB_USERS,
  lockoutThreshold: parsed.LOCKOUT_THRESHOLD,
  lockoutMinutes: parsed.LOCKOUT_MINUTES,
  appVersion: process.env.APP_VERSION || process.env.npm_package_version || "0.0.0",
  startupWarnings: warnings
};

export function printStartupBanner() {
  // Clear explicit startup logging so weak lab mode is immediately visible in terminal.
  // eslint-disable-next-line no-console
  console.log("=".repeat(72));
  // eslint-disable-next-line no-console
  console.log("RangePOS API startup");
  // eslint-disable-next-line no-console
  console.log(`ENV=${config.nodeEnv} LAB_MODE=${config.labMode} LAB_PROFILE=${config.labProfile}`);
  // eslint-disable-next-line no-console
  console.log(`RATE_LIMIT=${config.rateLimitEnabled} LOCKOUT=${config.lockoutEnabled} CSRF=${config.csrfEnabled}`);
  // eslint-disable-next-line no-console
  console.log("=".repeat(72));
}

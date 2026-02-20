import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";

const dbFileName = `test-security-${process.pid}-${Date.now()}.db`;
const dbRelativePath = `file:./${dbFileName}`;
const dbAbsolutePath = path.resolve(process.cwd(), "prisma", dbFileName);

process.env.NODE_ENV = "lab";
process.env.LAB_MODE = "true";
process.env.LAB_PROFILE = "secure";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = dbRelativePath;
process.env.SESSION_SECRET = "test-session-secret";
process.env.CSRF_ENABLED = "true";
process.env.RATE_LIMIT_ENABLED = "true";
process.env.LOCKOUT_ENABLED = "true";
process.env.LOCKOUT_THRESHOLD = "3";
process.env.LOCKOUT_MINUTES = "15";
process.env.EXPOSE_PAYMENT_TOKENS = "true";
process.env.PAYMENT_TOKEN_MODE = "strong";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.LOG_LEVEL = "silent";

function cleanupDbFiles() {
  const files = [
    dbAbsolutePath,
    `${dbAbsolutePath}-journal`,
    `${dbAbsolutePath}-shm`,
    `${dbAbsolutePath}-wal`
  ];

  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Best-effort cleanup for Windows file locks.
      }
    }
  }
}

let prisma;
let app;
let Role;

async function getCsrfToken(agent) {
  const csrfRes = await agent.get("/api/auth/csrf");
  assert.equal(csrfRes.status, 200);
  return csrfRes.body.csrfToken;
}

async function login(agent, username, password) {
  const csrfToken = await getCsrfToken(agent);
  return agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ username, password, rememberMe: false });
}

test.before(async () => {
  cleanupDbFiles();
  const { applyMigrations } = await import("../../prisma/run-migrations.js");
  await applyMigrations();

  const prismaModule = await import("@prisma/client");
  Role = prismaModule.Role;
  const PrismaClient = prismaModule.PrismaClient;
  prisma = new PrismaClient();

  const appModule = await import("../../src/app.js");
  app = appModule.createApp();

  const adminPassword = await bcrypt.hash("AdminPass123!", 10);
  const cashierPassword = await bcrypt.hash("CashierPass123!", 10);

  await prisma.user.createMany({
    data: [
      { username: "admin", passwordHash: adminPassword, role: Role.ADMIN, active: true },
      { username: "cashier", passwordHash: cashierPassword, role: Role.CASHIER, active: true }
    ]
  });

  const customer = await prisma.customer.create({
    data: {
      name: "Token Target",
      email: "token-target@example.com",
      phone: "555-0100"
    }
  });

  await prisma.paymentMethod.create({
    data: {
      customerId: customer.id,
      brand: "VISA",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      token: "pm_tok_sensitive_example"
    }
  });
});

test.after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  const dbModule = await import("../../src/db.js");
  await dbModule.prisma.$disconnect();
  cleanupDbFiles();
});

test("CASHIER cannot GET /api/customers", async () => {
  const agent = request.agent(app);
  const authRes = await login(agent, "cashier", "CashierPass123!");
  assert.equal(authRes.status, 200);

  const res = await agent.get("/api/customers");
  assert.equal(res.status, 403);
});

test("CASHIER can GET /api/customers/search and no token fields exist", async () => {
  const agent = request.agent(app);
  const authRes = await login(agent, "cashier", "CashierPass123!");
  assert.equal(authRes.status, 200);

  const res = await agent.get("/api/customers/search?q=Token");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  const first = res.body.items[0];
  assert.ok(first);
  assert.ok(Array.isArray(first.paymentMethods));
  assert.equal("token" in first.paymentMethods[0], false);
});

test("ADMIN GET /api/customers returns no tokens by default", async () => {
  const agent = request.agent(app);
  const authRes = await login(agent, "admin", "AdminPass123!");
  assert.equal(authRes.status, 200);

  const res = await agent.get("/api/customers");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  const first = res.body.items[0];
  assert.ok(first);
  assert.equal("token" in first.paymentMethods[0], false);
});

test("Token exposure requires includeTokens in LAB mode with EXPOSE_PAYMENT_TOKENS enabled", async () => {
  const agent = request.agent(app);
  const authRes = await login(agent, "admin", "AdminPass123!");
  assert.equal(authRes.status, 200);

  const listRes = await agent.get("/api/customers?size=1");
  const customerId = listRes.body.items[0].id;

  const detailNoToken = await agent.get(`/api/customers/${customerId}?includePaymentMethods=true`);
  assert.equal(detailNoToken.status, 200);
  assert.equal("token" in detailNoToken.body.customer.paymentMethods[0], false);

  const detailWithToken = await agent.get(
    `/api/customers/${customerId}?includePaymentMethods=true&includeTokens=true`
  );
  assert.equal(detailWithToken.status, 200);
  assert.equal(
    detailWithToken.body.customer.paymentMethods[0].token,
    "pm_tok_sensitive_example"
  );
});

test("Rate limiting and lockout behavior works when enabled", async () => {
  const rateLimitAgent = request.agent(app);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const res = await login(rateLimitAgent, "unknown-user", "bad-password");
    assert.equal(res.status, 401);
  }

  const limited = await login(rateLimitAgent, "unknown-user", "bad-password");
  assert.equal(limited.status, 429);

  const lockoutAgent = request.agent(app);
  const first = await login(lockoutAgent, "cashier", "wrong-pass");
  const second = await login(lockoutAgent, "cashier", "wrong-pass");
  const third = await login(lockoutAgent, "cashier", "wrong-pass");
  assert.equal(first.status, 401);
  assert.equal(second.status, 401);
  assert.equal(third.status, 423);
});

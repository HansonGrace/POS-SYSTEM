import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";

const dbFileName = `test-observability-${process.pid}-${Date.now()}.db`;
const dbRelativePath = `file:./${dbFileName}`;
const dbAbsolutePath = path.resolve(process.cwd(), "prisma", dbFileName);

process.env.NODE_ENV = "lab";
process.env.APP_ENV_LABEL = "test-observability";
process.env.LAB_MODE = "true";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = dbRelativePath;
process.env.SESSION_SECRET = "test-observability-secret";
process.env.CSRF_ENABLED = "true";
process.env.RATE_LIMIT_ENABLED = "true";
process.env.LOCKOUT_ENABLED = "true";
process.env.LOCKOUT_THRESHOLD = "3";
process.env.LOCKOUT_MINUTES = "15";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.LOG_LEVEL = "silent";
process.env.OBSERVABILITY_ENABLED = "true";
process.env.OBSERVABILITY_AUDIT_ENABLED = "true";
process.env.OBSERVABILITY_METRICS_ENABLED = "true";
process.env.TAX_RATE = "0.0825";

function cleanupDbFiles() {
  const files = [dbAbsolutePath, `${dbAbsolutePath}-journal`, `${dbAbsolutePath}-shm`, `${dbAbsolutePath}-wal`];
  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // best effort cleanup
      }
    }
  }
}

let prisma;
let app;
let registerId;
let productId;
let Role;

async function getCsrfToken(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200);
  return response.body.csrfToken;
}

async function login(agent, username, password) {
  const csrfToken = await getCsrfToken(agent);
  return agent.post("/api/auth/login").set("x-csrf-token", csrfToken).send({ username, password });
}

test.before(async () => {
  cleanupDbFiles();
  const { applyMigrations } = await import("../../prisma/run-migrations.js");
  await applyMigrations();

  const prismaModule = await import("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient;
  Role = prismaModule.Role;
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

  const register = await prisma.register.create({
    data: {
      identifier: "OBS-R1",
      name: "Observability Register",
      active: true
    }
  });
  registerId = register.id;

  const product = await prisma.product.create({
    data: {
      name: "Obs Item",
      sku: `OBS-SKU-${Date.now()}`,
      barcode: `OBS-BAR-${Date.now()}`,
      category: "Testing",
      priceCents: 500,
      inventoryCount: 20,
      active: true
    }
  });
  productId = product.id;
});

test.after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }
  const dbModule = await import("../../src/db.js");
  await dbModule.prisma.$disconnect();
  cleanupDbFiles();
});

test("request IDs propagate and observability captures audit + metrics", async () => {
  const correlationId = "test-observability-request-id";
  const health = await request(app).get("/api/health").set("x-request-id", correlationId);
  assert.equal(health.status, 200);
  assert.equal(health.headers["x-request-id"], correlationId);
  assert.equal(health.headers["x-correlation-id"], correlationId);

  const unknownAgent = request.agent(app);
  const failedLogin = await login(unknownAgent, "ghost-user", "bad-password");
  assert.equal(failedLogin.status, 401);

  const cashierAgent = request.agent(app);
  const cashierLogin = await login(cashierAgent, "cashier", "CashierPass123!");
  assert.equal(cashierLogin.status, 200);

  const openSessionToken = await getCsrfToken(cashierAgent);
  const opened = await cashierAgent
    .post("/api/register-sessions/open")
    .set("x-csrf-token", openSessionToken)
    .send({ registerId, startingBalanceCents: 10000 });
  assert.equal(opened.status, 201);

  const checkoutToken = await getCsrfToken(cashierAgent);
  const createdOrder = await cashierAgent
    .post("/api/orders")
    .set("x-csrf-token", checkoutToken)
    .send({
      registerSessionId: opened.body.session.id,
      paymentType: "CASH",
      items: [{ productId, quantity: 1 }]
    });
  assert.equal(createdOrder.status, 201);

  const scanMiss = await cashierAgent.get("/api/products/scan/does-not-exist");
  assert.equal(scanMiss.status, 404);

  const adminAgent = request.agent(app);
  const adminLogin = await login(adminAgent, "admin", "AdminPass123!");
  assert.equal(adminLogin.status, 200);

  const runtime = await adminAgent.get("/api/admin/observability");
  assert.equal(runtime.status, 200);
  const counters = runtime.body.observability.runtime.counters;
  assert.ok(counters.some((counter) => counter.name === "login_attempts_total" && counter.value >= 2));
  assert.ok(counters.some((counter) => counter.name === "api_error_count" && counter.value >= 1));

  const loginFailedAudit = await prisma.auditLog.count({ where: { action: "auth_login_failed" } });
  const orderCreatedAudit = await prisma.auditLog.count({ where: { action: "order_created" } });
  assert.ok(loginFailedAudit >= 1);
  assert.ok(orderCreatedAudit >= 1);
});

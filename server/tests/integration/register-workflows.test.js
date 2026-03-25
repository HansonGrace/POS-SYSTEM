import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";

const dbFileName = `test-register-workflows-${process.pid}-${Date.now()}.db`;
const dbRelativePath = `file:./${dbFileName}`;
const dbAbsolutePath = path.resolve(process.cwd(), "prisma", dbFileName);

process.env.NODE_ENV = "lab";
process.env.APP_ENV_LABEL = "test-register-workflows";
process.env.LAB_MODE = "true";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = dbRelativePath;
process.env.SESSION_SECRET = "test-register-workflow-secret";
process.env.CSRF_ENABLED = "true";
process.env.RATE_LIMIT_ENABLED = "true";
process.env.LOCKOUT_ENABLED = "true";
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
  const response = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ username, password, rememberMe: false });
  assert.equal(response.status, 200);
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

  const cashierPassword = await bcrypt.hash("CashierPass123!", 10);
  await prisma.user.create({
    data: {
      username: "cashier",
      passwordHash: cashierPassword,
      role: Role.CASHIER,
      active: true
    }
  });

  const register = await prisma.register.create({
    data: {
      identifier: "SHIFT-1",
      name: "Shift Register",
      active: true
    }
  });
  registerId = register.id;

  const product = await prisma.product.create({
    data: {
      name: "Workflow Product",
      sku: `WF-SKU-${Date.now()}`,
      barcode: `WF-BAR-${Date.now()}`,
      category: "Testing",
      priceCents: 799,
      inventoryCount: 12,
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

test("register open/close, drawer events, suspend/resume sale, and checkout", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const openToken = await getCsrfToken(agent);
  const opened = await agent
    .post("/api/register-sessions/open")
    .set("x-csrf-token", openToken)
    .send({ registerId, startingBalanceCents: 5000 });
  assert.equal(opened.status, 201);
  assert.equal(opened.body.session.status, "OPEN");

  const drawerToken = await getCsrfToken(agent);
  const drawerEvent = await agent
    .post(`/api/register-sessions/${opened.body.session.id}/drawer-events`)
    .set("x-csrf-token", drawerToken)
    .send({ type: "NO_SALE", amountCents: 0, reason: "Test drawer event" });
  assert.equal(drawerEvent.status, 201);

  const suspendToken = await getCsrfToken(agent);
  const suspended = await agent
    .post("/api/orders/suspended")
    .set("x-csrf-token", suspendToken)
    .send({
      registerSessionId: opened.body.session.id,
      items: [{ productId, quantity: 2 }],
      note: "Customer forgot wallet"
    });
  assert.equal(suspended.status, 201);
  const suspendedSaleId = suspended.body.suspendedSale.id;

  const resumedToken = await getCsrfToken(agent);
  const resumed = await agent
    .post(`/api/orders/suspended/${suspendedSaleId}/resume`)
    .set("x-csrf-token", resumedToken)
    .send({});
  assert.equal(resumed.status, 200);
  assert.equal(Array.isArray(resumed.body.resumeCart), true);
  assert.equal(resumed.body.resumeCart.length, 1);

  const checkoutToken = await getCsrfToken(agent);
  const checkout = await agent
    .post("/api/orders")
    .set("x-csrf-token", checkoutToken)
    .send({
      registerSessionId: opened.body.session.id,
      suspendedSaleId,
      paymentType: "CASH",
      items: [{ productId, quantity: 2 }]
    });
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.order.status, "COMPLETED");

  const printToken = await getCsrfToken(agent);
  const printed = await agent
    .post(`/api/orders/${checkout.body.order.id}/print`)
    .set("x-csrf-token", printToken)
    .send({});
  assert.equal(printed.status, 201);
  assert.ok(String(printed.body.printJob.output).includes(`ORDER #${checkout.body.order.id}`));

  const closeToken = await getCsrfToken(agent);
  const closed = await agent
    .post(`/api/register-sessions/${opened.body.session.id}/close`)
    .set("x-csrf-token", closeToken)
    .send({ endingBalanceCents: 6200 });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.session.status, "CLOSED");

  const drawerEventCount = await prisma.cashDrawerEvent.count({
    where: { registerSessionId: opened.body.session.id }
  });
  assert.equal(drawerEventCount, 1);

  const checkedOutSuspended = await prisma.suspendedSale.findUnique({ where: { id: suspendedSaleId } });
  assert.equal(checkedOutSuspended?.status, "CHECKED_OUT");
  assert.equal(checkedOutSuspended?.checkoutOrderId, checkout.body.order.id);
});

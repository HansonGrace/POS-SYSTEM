import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { TenderType, TransactionStatus } from "@prisma/client";
import request from "supertest";

const dbFileName = `test-transactions-${process.pid}-${Date.now()}.db`;
const dbRelativePath = `file:./${dbFileName}`;
const dbAbsolutePath = path.resolve(process.cwd(), "prisma", dbFileName);

process.env.NODE_ENV = "lab";
process.env.LAB_MODE = "true";
process.env.LAB_PROFILE = "secure";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = dbRelativePath;
process.env.SESSION_SECRET = "test-transaction-secret";
process.env.CSRF_ENABLED = "true";
process.env.RATE_LIMIT_ENABLED = "true";
process.env.LOCKOUT_ENABLED = "true";
process.env.LOCKOUT_THRESHOLD = "3";
process.env.LOCKOUT_MINUTES = "15";
process.env.EXPOSE_PAYMENT_TOKENS = "true";
process.env.PAYMENT_TOKEN_MODE = "strong";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.LOG_LEVEL = "silent";
process.env.TAX_RATE = "0.0825";

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
        // best effort cleanup
      }
    }
  }
}

function calculateTax(total) {
  return Math.round(total * 0.0825);
}

let prisma;
let app;
let register;

async function getCsrfToken(agent) {
  const csrfRes = await agent.get("/api/auth/csrf");
  assert.equal(csrfRes.status, 200);
  return csrfRes.body.csrfToken;
}

async function login(agent, username, password) {
  const csrfToken = await getCsrfToken(agent);
  const loginRes = await agent
    .post("/api/auth/login")
    .set("x-csrf-token", csrfToken)
    .send({ username, password, rememberMe: false });

  assert.equal(loginRes.status, 200);
}

async function createTransaction(agent, registerId) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post("/api/transactions")
    .set("x-csrf-token", csrfToken)
    .send({ registerId, notes: "test" });

  assert.equal(response.status, 201);
  assert.equal(response.body.transaction.status, "DRAFT");
  return response.body.transaction;
}

async function createProduct(data) {
  return prisma.product.create({
    data: {
      name: data.name,
      sku: data.sku,
      barcode: data.barcode,
      category: "Testing",
      priceCents: data.priceCents,
      inventoryCount: data.inventoryCount,
      active: true
    }
  });
}

async function addItems(transactionId, items, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/items`)
    .set("x-csrf-token", csrfToken)
    .send({ items });

  assert.equal(response.status, 200);
  return response.body.transaction;
}

async function finalize(transactionId, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/finalize`)
    .set("x-csrf-token", csrfToken)
    .send({});

  assert.equal(response.status, 200);
  return response.body.transaction;
}

async function addPayment(transactionId, payment, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/payments`)
    .set("x-csrf-token", csrfToken)
    .send(payment);

  assert.equal(response.status, 201);
  return response.body;
}

async function createBasicTransaction(agent, options = {}) {
  const transaction = await createTransaction(agent, options.registerId || register.id);
  const productA = await createProduct({
    name: `Product A ${Date.now()}`,
    sku: `SKU-A-${Date.now()}`,
    barcode: `BAR-A-${Date.now()}`,
    priceCents: 500,
    inventoryCount: 10
  });

  const refreshed = await addItems(
    transaction.id,
    [
      {
        productId: productA.id,
        quantity: options.quantity || 2,
        unitDiscountCents: options.discount || 0
      }
    ],
    agent
  );

  return {
    transaction: refreshed,
    productA
  };
}

test.before(async () => {
  cleanupDbFiles();
  const { applyMigrations } = await import("../../prisma/run-migrations.js");
  await applyMigrations();

  const prismaModule = await import("@prisma/client");
  const PrismaClient = prismaModule.PrismaClient;
  const Role = prismaModule.Role;
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

  await prisma.register.create({
    data: {
      identifier: "TX-TEST",
      name: "Test Register",
      location: "Demo",
      active: true
    }
  });

  register = await prisma.register.findUnique({ where: { identifier: "TX-TEST" } });
  assert.ok(register?.id);
});

test.after(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }

  const dbModule = await import("../../src/db.js");
  await dbModule.prisma.$disconnect();
  cleanupDbFiles();
});

test("POST /api/transactions creates a draft transaction", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const transaction = await createTransaction(agent, register.id);

  assert.equal(typeof transaction.id, "number");
  assert.equal(transaction.status, TransactionStatus.DRAFT);
});

test("add line items, calculate subtotal/tax/total, and persist totals", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const transaction = await createTransaction(agent, register.id);

  const p1 = await createProduct({
    name: "Milk",
    sku: `SKU-M-${Date.now()}`,
    barcode: `BAR-M-${Date.now()}`,
    priceCents: 499,
    inventoryCount: 20
  });

  const p2 = await createProduct({
    name: "Bread",
    sku: `SKU-B-${Date.now()}`,
    barcode: `BAR-B-${Date.now()}`,
    priceCents: 299,
    inventoryCount: 10
  });

  const updated = await addItems(
    transaction.id,
    [
      { productId: p1.id, quantity: 2, unitDiscountCents: 0 },
      { productId: p2.id, quantity: 1, unitDiscountCents: 50 }
    ],
    agent
  );

  const expectedSubtotal = 2 * 499 + 299 - 50;
  const expectedTax = calculateTax(expectedSubtotal);

  assert.equal(updated.subtotalCents, expectedSubtotal);
  assert.equal(updated.taxTotalCents, expectedTax);
  assert.equal(updated.totalCents, expectedSubtotal + expectedTax);
  assert.equal(updated.items.length, 2);
  assert.equal(updated.items[0].productNameSnapshot, "Milk");
  assert.equal(updated.items[1].productNameSnapshot, "Bread");
});

test("transaction supports multiple payment methods and records paid state", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const p = await createProduct({
    name: `Multi Pay ${Date.now()}`,
    sku: `SKU-MP-${Date.now()}`,
    barcode: `BAR-MP-${Date.now()}`,
    priceCents: 1000,
    inventoryCount: 20
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: p.id, quantity: 1, unitDiscountCents: 0 }], agent);

  const total = 1000 + calculateTax(1000);
  const partial = Math.floor(total / 2);
  const remaining = total - partial;

  await addPayment(
    transaction.id,
    {
      tenderType: TenderType.CASH,
      amountCents: partial,
      reference: "CASH-1"
    },
    agent
  );

  const secondPayment = await addPayment(
    transaction.id,
    {
      tenderType: TenderType.CARD,
      amountCents: remaining,
      reference: "CARD-1"
    },
    agent
  );

  assert.equal(secondPayment.transaction.paymentStatus, "PAID");

  const refreshed = await agent
    .get(`/api/transactions/${transaction.id}`)
    .set("x-csrf-token", await getCsrfToken(agent));

  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.transaction.paymentStatus, "PAID");
  assert.equal(refreshed.body.transaction.payments.length, 2);

  const finalized = await finalize(transaction.id, agent);
  assert.equal(finalized.status, TransactionStatus.FINALIZED);
});

test("refund flow creates refund records and prevents over-refund", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const p = await createProduct({
    name: `Refund Product ${Date.now()}`,
    sku: `SKU-RF-${Date.now()}`,
    barcode: `BAR-RF-${Date.now()}`,
    priceCents: 800,
    inventoryCount: 15
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: p.id, quantity: 2, unitDiscountCents: 0 }], agent);
  await finalize(transaction.id, agent);

  const csrfToken = await getCsrfToken(agent);
  const refund = await agent
    .post(`/api/transactions/${transaction.id}/refunds`)
    .set("x-csrf-token", csrfToken)
    .send({
      amountCents: 300,
      reason: "customer returned"
    });

  assert.equal(refund.status, 200);
  assert.equal(refund.body.transaction.status, TransactionStatus.PARTIALLY_REFUNDED);
  assert.equal(refund.body.transaction.refunds.length, 1);

  const overRefund = await agent
    .post(`/api/transactions/${transaction.id}/refunds`)
    .set("x-csrf-token", csrfToken)
    .send({ amountCents: 999999 });

  assert.equal(overRefund.status, 409);
});

test("rollback behavior preserves stock when finalization fails", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const inStock = await createProduct({
    name: `In Stock ${Date.now()}`,
    sku: `SKU-IS-${Date.now()}`,
    barcode: `BAR-IS-${Date.now()}`,
    priceCents: 400,
    inventoryCount: 1
  });

  const outOfStock = await createProduct({
    name: `Out of Stock ${Date.now()}`,
    sku: `SKU-OOS-${Date.now()}`,
    barcode: `BAR-OOS-${Date.now()}`,
    priceCents: 200,
    inventoryCount: 0
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(
    transaction.id,
    [
      { productId: inStock.id, quantity: 1, unitDiscountCents: 0 },
      { productId: outOfStock.id, quantity: 1, unitDiscountCents: 0 }
    ],
    agent
  );

  const failedFinalize = await request(agent)
    .post(`/api/transactions/${transaction.id}/finalize`)
    .set("x-csrf-token", await getCsrfToken(agent))
    .send({});

  assert.equal(failedFinalize.status, 409);

  const refreshedInStock = await prisma.product.findUnique({ where: { id: inStock.id } });
  const refreshedOutStock = await prisma.product.findUnique({ where: { id: outOfStock.id } });

  assert.equal(refreshedInStock?.inventoryCount, 1);
  assert.equal(refreshedOutStock?.inventoryCount, 0);
});

test("void transaction restores inventory and marks voided", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const p = await createProduct({
    name: `Void Product ${Date.now()}`,
    sku: `SKU-VD-${Date.now()}`,
    barcode: `BAR-VD-${Date.now()}`,
    priceCents: 500,
    inventoryCount: 3
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: p.id, quantity: 2, unitDiscountCents: 0 }], agent);
  await finalize(transaction.id, agent);

  const beforeVoid = await prisma.product.findUnique({ where: { id: p.id } });
  assert.equal(beforeVoid?.inventoryCount, 1);

  const voided = await agent
    .post(`/api/transactions/${transaction.id}/void`)
    .set("x-csrf-token", await getCsrfToken(agent))
    .send({ reason: "operator corrected" });

  assert.equal(voided.status, 200);
  assert.equal(voided.body.transaction.status, TransactionStatus.VOIDED);

  const afterVoid = await prisma.product.findUnique({ where: { id: p.id } });
  assert.equal(afterVoid?.inventoryCount, 3);
});

test("historical line item snapshots remain unchanged after catalog price updates", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const product = await createProduct({
    name: `Historic Product ${Date.now()}`,
    sku: `SKU-HX-${Date.now()}`,
    barcode: `BAR-HX-${Date.now()}`,
    priceCents: 650,
    inventoryCount: 5
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: product.id, quantity: 1, unitDiscountCents: 0 }], agent);
  await finalize(transaction.id, agent);

  await prisma.product.update({
    where: { id: product.id },
    data: { priceCents: 1200 }
  });

  const byId = await request(agent)
    .get(`/api/transactions/${transaction.id}`)
    .set("x-csrf-token", await getCsrfToken(agent));

  assert.equal(byId.status, 200);
  assert.equal(byId.body.transaction.items[0].unitPriceCents, 650);
  assert.equal(byId.body.transaction.items[0].productId, product.id);
});

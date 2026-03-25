import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { TenderType, TransactionStatus } from "@prisma/client";
import request from "supertest";

process.env.NODE_ENV = "lab";
process.env.LAB_MODE = "true";
process.env.LAB_PROFILE = "secure";
process.env.DATABASE_PROVIDER = "sqlite";
process.env.DATABASE_URL = `file:${`test-payments-${process.pid}-${Date.now()}.db`}`;
process.env.SESSION_SECRET = "test-payment-secret-long-value";
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

const dbRelativePath = process.env.DATABASE_URL;
const dbAbsolutePath = path.resolve(process.cwd(), "prisma", path.basename(dbRelativePath));

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
        // Best-effort cleanup.
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
  return response;
}

async function createTransaction(agent, registerId) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post("/api/transactions")
    .set("x-csrf-token", csrfToken)
    .send({ registerId, notes: "payment architecture" });

  assert.equal(response.status, 201);
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

async function submitPayment(transactionId, payment, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/payments`)
    .set("x-csrf-token", csrfToken)
    .send(payment);

  assert.equal(response.status, 201);
  return response.body;
}

async function startPayment(transactionId, payment, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/payments/start`)
    .set("x-csrf-token", csrfToken)
    .send(payment);

  assert.equal(response.status, 201);
  return response.body;
}

async function completePayment(transactionId, paymentId, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/payments/${paymentId}/complete`)
    .set("x-csrf-token", csrfToken)
    .send({});

  return response;
}

async function refundPayment(transactionId, paymentId, payload, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/payments/${paymentId}/refunds`)
    .set("x-csrf-token", csrfToken)
    .send(payload);

  return response;
}

async function voidPayment(transactionId, paymentId, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/payments/${paymentId}/void`)
    .set("x-csrf-token", csrfToken)
    .send({});

  return response;
}

async function finalizeTransaction(transactionId, agent) {
  const csrfToken = await getCsrfToken(agent);
  const response = await agent
    .post(`/api/transactions/${transactionId}/finalize`)
    .set("x-csrf-token", csrfToken)
    .send({});

  return response;
}

async function fetchTransaction(agent, transactionId) {
  const response = await agent.get(`/api/transactions/${transactionId}`);
  return response.body.transaction;
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
      identifier: "PAYMENT-TEST",
      name: "Payment Register",
      location: "Demo",
      active: true
    }
  });

  register = await prisma.register.findUnique({ where: { identifier: "PAYMENT-TEST" } });
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

test("successful cash payment through mock provider", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Cash Item ${Date.now()}`,
    sku: `SKCASH-${Date.now()}`,
    barcode: `BARCASH-${Date.now()}`,
    priceCents: 500,
    inventoryCount: 20
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 2, unitDiscountCents: 0 }], agent);

  const total = 1000 + calculateTax(1000);
  const result = await submitPayment(transaction.id, {
    tenderType: TenderType.CASH,
    amountCents: total,
    reference: "CASH-1"
  }, agent);

  assert.equal(result.payment.status, "COMPLETED");
  assert.equal(result.transaction.paymentStatus, "PAID");
});

test("card-style payment can be started and completed in two steps", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Card Item ${Date.now()}`,
    sku: `SKCARD-${Date.now()}`,
    barcode: `BARCARD-${Date.now()}`,
    priceCents: 800,
    inventoryCount: 20
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);

  const start = await startPayment(transaction.id, {
    tenderType: TenderType.CARD,
    amountCents: 900,
    reference: "CARD-START"
  }, agent);

  assert.equal(start.payment.status, "AUTHORIZED");

  const complete = await completePayment(transaction.id, start.payment.id, agent);
  assert.equal(complete.status, 200);
  assert.equal(complete.body.payment.status, "COMPLETED");
});

test("card provider failure is returned as failed payment", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Decline Item ${Date.now()}`,
    sku: `SKDECL-${Date.now()}`,
    barcode: `BARDECL-${Date.now()}`,
    priceCents: 600,
    inventoryCount: 20
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);

  const total = 600 + calculateTax(600);
  const result = await submitPayment(transaction.id, {
    tenderType: TenderType.CARD,
    amountCents: total,
    reference: "decline-card-mock"
  }, agent);

  assert.equal(result.payment.status, "FAILED");
});

test("multiple split payments share one transaction", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Split Item ${Date.now()}`,
    sku: `SKSPLIT-${Date.now()}`,
    barcode: `BARSPLIT-${Date.now()}`,
    priceCents: 1200,
    inventoryCount: 20
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);
  const total = 1200 + calculateTax(1200);

  await submitPayment(transaction.id, {
    tenderType: TenderType.CASH,
    amountCents: Math.floor(total / 2),
    reference: "SPLIT-CASH"
  }, agent);

  const split = await submitPayment(transaction.id, {
    tenderType: TenderType.CARD,
    amountCents: total - Math.floor(total / 2),
    reference: "SPLIT-CARD"
  }, agent);

  assert.equal(split.transaction.payments.length, 2);
  assert.equal(split.transaction.paymentStatus, "PAID");
});

test("invalid payment amount is rejected and over-payment is prevented", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Invalid Item ${Date.now()}`,
    sku: `SKINV-${Date.now()}`,
    barcode: `BARINV-${Date.now()}`,
    priceCents: 500,
    inventoryCount: 5
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);
  const total = 500 + calculateTax(500);

  const csrfToken = await getCsrfToken(agent);
  const badPayload = await agent
    .post(`/api/transactions/${transaction.id}/payments`)
    .set("x-csrf-token", csrfToken)
    .send({
      tenderType: TenderType.CASH,
      amountCents: 0
    });

  assert.equal(badPayload.status, 400);

  const badOver = await submitPayment(transaction.id, {
    tenderType: TenderType.CASH,
    amountCents: total + 200,
    reference: "OVR"
  }, agent);

  assert.equal(badOver.transaction.paymentStatus, "PENDING");
  assert.equal(badOver.payment.status, "FAILED");
});

test("payment refund and over-refund prevention", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Refund Item ${Date.now()}`,
    sku: `SKRF-${Date.now()}`,
    barcode: `BARRF-${Date.now()}`,
    priceCents: 700,
    inventoryCount: 8
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);
  const paid = await submitPayment(transaction.id, {
    tenderType: TenderType.CASH,
    amountCents: 700 + calculateTax(700),
    reference: "RF-1"
  }, agent);

  const paymentId = paid.payment.id;
  const refund = await refundPayment(transaction.id, paymentId, { amountCents: 200 }, agent);
  assert.equal(refund.status, 200);
  assert.equal(refund.body.payment.status, "PARTIALLY_REFUNDED");

  const failed = await refundPayment(transaction.id, paymentId, { amountCents: 999999 }, agent);
  assert.equal(failed.status, 409);
});

test("void payment preserves transaction and blocks duplicate completion", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Void Payment ${Date.now()}`,
    sku: `SKVOID-${Date.now()}`,
    barcode: `BARVOID-${Date.now()}`,
    priceCents: 900,
    inventoryCount: 10
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);
  const started = await startPayment(transaction.id, {
    tenderType: TenderType.CARD,
    amountCents: 900 + calculateTax(900),
    reference: "VOID-PAY"
  }, agent);

  const firstComplete = await completePayment(transaction.id, started.payment.id, agent);
  assert.equal(firstComplete.status, 200);
  assert.equal(firstComplete.body.payment.status, "COMPLETED");

  const secondComplete = await completePayment(transaction.id, started.payment.id, agent);
  assert.equal(secondComplete.status, 409);

  const voided = await voidPayment(transaction.id, started.payment.id, agent);
  assert.equal(voided.status, 200);
  assert.equal(voided.body.payment.status, "VOIDED");
});

test("transaction finalization occurs only after payment completion", async () => {
  const agent = request.agent(app);
  await login(agent, "cashier", "CashierPass123!");

  const item = await createProduct({
    name: `Finalize Item ${Date.now()}`,
    sku: `SKFIZ-${Date.now()}`,
    barcode: `BARFIZ-${Date.now()}`,
    priceCents: 500,
    inventoryCount: 10
  });

  const transaction = await createTransaction(agent, register.id);
  await addItems(transaction.id, [{ productId: item.id, quantity: 1, unitDiscountCents: 0 }], agent);
  const total = 500 + calculateTax(500);
  await submitPayment(transaction.id, {
    tenderType: TenderType.CARD,
    amountCents: total,
    reference: "FINALIZE"
  }, agent);

  const finalized = await finalizeTransaction(transaction.id, agent);
  assert.equal(finalized.status, 200);
  assert.equal(finalized.body.transaction.status, TransactionStatus.FINALIZED);
  assert.equal(finalized.body.transaction.paymentStatus, "PAID");
});

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { parsePageQuery, createPageResult } from "../utils/pagination.js";
import { redactCustomer, redactPaymentMethod } from "../security/redaction.js";
import { emitSecurityEvent } from "../security/events.js";
import { generatePaymentToken } from "../security/paymentTokens.js";
import { config } from "../config.js";

const router = Router();

const customerSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().min(5).max(20).optional().nullable()
});

const paymentMethodSchema = z.object({
  brand: z.string().trim().min(2),
  last4: z.string().trim().regex(/^\d{4}$/),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(new Date().getFullYear()),
  token: z.string().trim().min(8).optional()
});

function asBoolean(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

router.get("/", requirePermission(permissions.CUSTOMER_READ_ALL), async (req, res) => {
  const { page, size, skip, take } = parsePageQuery(req.query);

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      include: {
        paymentMethods: {
          select: {
            id: true,
            brand: true,
            last4: true,
            expMonth: true,
            expYear: true,
            token: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take
    }),
    prisma.customer.count()
  ]);

  await emitSecurityEvent("data_customers_list_access", { count: customers.length, page, size }, req);

  const redacted = customers.map((customer) =>
    redactCustomer(customer, { includePaymentMethods: true, includeTokens: false })
  );

  return res.json(createPageResult({ items: redacted, page, size, total }));
});

router.get(
  "/search",
  requireAnyPermission(permissions.CUSTOMER_SEARCH, permissions.CUSTOMER_READ_ALL),
  async (req, res) => {
    const { page, size, skip, take } = parsePageQuery(req.query);
    const term = String(req.query.q || "").trim();

    const where = term
      ? {
          OR: [
            { name: { contains: term } },
            { email: { contains: term } },
            { phone: { contains: term } }
          ]
        }
      : {};

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        include: {
          paymentMethods: {
            select: {
              id: true,
              brand: true,
              last4: true,
              expMonth: true,
              expYear: true,
              createdAt: true
            },
            orderBy: { createdAt: "desc" },
            take: 3
          }
        },
        orderBy: [{ name: "asc" }, { id: "desc" }],
        skip,
        take
      }),
      prisma.customer.count({ where })
    ]);

    await emitSecurityEvent(
      "data_customer_search",
      { count: customers.length, page, size, hasQuery: Boolean(term) },
      req
    );

    const minimal = customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      createdAt: customer.createdAt,
      paymentMethods: customer.paymentMethods.map((method) => ({
        id: method.id,
        brand: method.brand,
        last4: method.last4,
        expMonth: method.expMonth,
        expYear: method.expYear,
        createdAt: method.createdAt
      }))
    }));

    return res.json(createPageResult({ items: minimal, page, size, total }));
  }
);

router.get("/:id", requirePermission(permissions.CUSTOMER_READ_DETAIL), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid customer id." });
  }

  const includePaymentMethods = asBoolean(req.query.includePaymentMethods);
  const includeTokens = asBoolean(req.query.includeTokens);
  const tokenAllowed = config.labMode && config.exposePaymentTokens && includeTokens;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: includePaymentMethods
      ? {
          paymentMethods: {
            select: {
              id: true,
              brand: true,
              last4: true,
              expMonth: true,
              expYear: true,
              token: true,
              createdAt: true
            }
          }
        }
      : undefined
  });

  if (!customer) {
    return res.status(404).json({ message: "Customer not found." });
  }

  if (includeTokens) {
    await emitSecurityEvent(
      "data_customer_token_access",
      {
        customerId: id,
        tokenReturned: tokenAllowed
      },
      req
    );
  }

  await emitSecurityEvent(
    "data_customer_detail_access",
    { customerId: id, includePaymentMethods, includeTokens: tokenAllowed },
    req
  );

  const payload = redactCustomer(customer, { includePaymentMethods, includeTokens: tokenAllowed });
  return res.json({ customer: payload });
});

router.post("/", requirePermission(permissions.CUSTOMER_WRITE), async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid customer payload." });
  }

  try {
    const customer = await prisma.customer.create({
      data: {
        ...parsed.data,
        email: parsed.data.email || null,
        phone: parsed.data.phone || null
      }
    });

    await emitSecurityEvent("customer_created", { customerId: customer.id }, req);
    return res.status(201).json({ customer });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Customer email already exists." });
    }
    return res.status(500).json({ message: "Failed to create customer." });
  }
});

router.put("/:id", requirePermission(permissions.CUSTOMER_WRITE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid customer id." });
  }

  const parsed = customerSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid customer payload." });
  }

  const data = { ...parsed.data };
  if (data.email === "") {
    data.email = null;
  }
  if (data.phone === "") {
    data.phone = null;
  }

  try {
    const customer = await prisma.customer.update({
      where: { id },
      data
    });

    await emitSecurityEvent("customer_updated", { customerId: id }, req);
    return res.json({ customer });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Customer email already exists." });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Customer not found." });
    }
    return res.status(500).json({ message: "Failed to update customer." });
  }
});

router.post("/:id/payment-methods", requirePermission(permissions.PAYMENT_METHOD_CREATE), async (req, res) => {
  const customerId = Number(req.params.id);
  if (!Number.isInteger(customerId)) {
    return res.status(400).json({ message: "Invalid customer id." });
  }

  const parsed = paymentMethodSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payment method payload." });
  }

  const token =
    parsed.data.token ||
    generatePaymentToken(`${customerId}:${parsed.data.brand}:${parsed.data.last4}:${parsed.data.expYear}`);

  try {
    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        customerId,
        brand: parsed.data.brand,
        last4: parsed.data.last4,
        expMonth: parsed.data.expMonth,
        expYear: parsed.data.expYear,
        token
      }
    });

    await emitSecurityEvent(
      "payment_method_added",
      { customerId, paymentMethodId: paymentMethod.id, tokenMode: config.paymentTokenMode },
      req
    );

    return res.status(201).json({ paymentMethod: redactPaymentMethod(paymentMethod) });
  } catch (error) {
    if (error.code === "P2003" || error.code === "P2025") {
      return res.status(404).json({ message: "Customer not found." });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ message: "Payment token already exists." });
    }
    return res.status(500).json({ message: "Failed to create payment method." });
  }
});

export default router;

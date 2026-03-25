import { Router } from "express";
import { OrderStatus, PaymentType, Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAnyPermission, requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { computeTax } from "../utils/money.js";
import { parsePageQuery, createPageResult } from "../utils/pagination.js";
import { emitSecurityEvent } from "../security/events.js";
import { incrementMetric } from "../observability/metrics.js";
import {
  assertWeakPaymentTokenModeEnabled,
  generatePaymentToken
} from "../security/paymentTokens.js";
import { createPrintJob, listPrintJobs } from "../services/core/printerSimulatorService.js";
import { requireOpenRegisterSession } from "../services/core/registerWorkflowService.js";
import { TransactionError } from "../services/core/errors.js";

const router = Router();

class InsufficientStockError extends Error {
  constructor(message, product) {
    super(message);
    this.name = "InsufficientStockError";
    this.product = product;
  }
}

const createOrderSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  paymentType: z.nativeEnum(PaymentType),
  registerSessionId: z.number().int().positive().optional(),
  suspendedSaleId: z.number().int().positive().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive()
      })
    )
    .min(1),
  saveCardOnFile: z.boolean().optional().default(false),
  card: z
    .object({
      brand: z.string().trim().min(2),
      last4: z.string().trim().regex(/^\d{4}$/),
      expMonth: z.number().int().min(1).max(12),
      expYear: z.number().int().min(new Date().getFullYear()),
      token: z.string().trim().min(8).optional()
    })
    .optional()
});

const suspendSaleSchema = z.object({
  registerSessionId: z.number().int().positive().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(320).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().positive()
      })
    )
    .min(1)
});

function buildOrderWhere(query) {
  const where = {};

  if (typeof query.cashierId === "string" && query.cashierId) {
    const cashierId = Number(query.cashierId);
    if (Number.isInteger(cashierId)) {
      where.cashierId = cashierId;
    }
  }

  if (typeof query.status === "string" && Object.values(OrderStatus).includes(query.status)) {
    where.status = query.status;
  }

  if (typeof query.startDate === "string" || typeof query.endDate === "string") {
    where.createdAt = {};

    if (typeof query.startDate === "string" && query.startDate) {
      where.createdAt.gte = new Date(query.startDate);
    }

    if (typeof query.endDate === "string" && query.endDate) {
      const end = new Date(query.endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  return where;
}

async function resolvePricedItems(inputItems) {
  const uniqueProductIds = [...new Set(inputItems.map((item) => item.productId))];

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, active: true },
    select: { id: true, name: true, priceCents: true, inventoryCount: true, active: true }
  });

  if (products.length !== uniqueProductIds.length) {
    throw new TransactionError("INVALID_INPUT", "One or more products are unavailable.", 400);
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  const normalizedItems = [];
  let subtotalCents = 0;

  for (const item of inputItems) {
    const product = byId.get(item.productId);
    if (!product) {
      throw new TransactionError("INVALID_INPUT", "Invalid product in cart.", 400);
    }

    const lineTotalCents = product.priceCents * item.quantity;
    subtotalCents += lineTotalCents;
    normalizedItems.push({
      productId: product.id,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
      lineTotalCents
    });
  }

  return {
    productsById: byId,
    normalizedItems,
    subtotalCents,
    taxCents: computeTax(subtotalCents, config.taxRate),
    totalCents: subtotalCents + computeTax(subtotalCents, config.taxRate)
  };
}

router.post("/", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid order payload." });
  }

  const {
    items,
    paymentType,
    customerId,
    saveCardOnFile,
    card,
    registerSessionId,
    suspendedSaleId
  } = parsed.data;

  try {
    const session = await requireOpenRegisterSession(prisma, req.user.id, registerSessionId || null);
    const pricing = await resolvePricedItems(items);

    const createdOrder = await prisma.$transaction(async (tx) => {
      for (const item of pricing.normalizedItems) {
        const updated = await tx.product.updateMany({
          where: {
            id: item.productId,
            active: true,
            inventoryCount: { gte: item.quantity }
          },
          data: { inventoryCount: { decrement: item.quantity } }
        });

        if (updated.count !== 1) {
          const conflictedProduct = pricing.productsById.get(item.productId);
          throw new InsufficientStockError(
            `Insufficient inventory for ${conflictedProduct?.name || "product"}.`,
            conflictedProduct
          );
        }
      }

      if (paymentType === PaymentType.CARD && saveCardOnFile) {
        if (!customerId || !card) {
          throw new TransactionError(
            "INVALID_INPUT",
            "Customer and card fields are required when saving card on file.",
            400
          );
        }

        assertWeakPaymentTokenModeEnabled();
        await tx.paymentMethod.create({
          data: {
            customerId,
            brand: card.brand,
            last4: card.last4,
            expMonth: card.expMonth,
            expYear: card.expYear,
            token:
              card.token ||
              generatePaymentToken(`${customerId}:${card.brand}:${card.last4}:${card.expYear}`)
          }
        });
      }

      const order = await tx.order.create({
        data: {
          cashierId: req.user.id,
          customerId: customerId || null,
          subtotalCents: pricing.subtotalCents,
          taxCents: pricing.taxCents,
          totalCents: pricing.totalCents,
          status: OrderStatus.COMPLETED,
          paymentType,
          items: {
            createMany: {
              data: pricing.normalizedItems
            }
          }
        },
        include: {
          cashier: {
            select: {
              id: true,
              username: true,
              role: true
            }
          },
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              createdAt: true
            }
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  barcode: true
                }
              }
            }
          }
        }
      });

      if (suspendedSaleId) {
        await tx.suspendedSale.updateMany({
          where: {
            id: suspendedSaleId,
            cashierId: req.user.id,
            status: "RESUMED"
          },
          data: {
            status: "CHECKED_OUT",
            checkoutOrderId: order.id
          }
        });
      }

      return order;
    });

    if (config.observabilityMetricsEnabled) {
      incrementMetric("transactions_finalized_total", { path: "orders", paymentType });
    }
    await emitSecurityEvent(
      "order_created",
      {
        orderId: createdOrder.id,
        paymentType,
        totalCents: createdOrder.totalCents,
        registerSessionId: session.id
      },
      req
    );

    if (paymentType === PaymentType.CARD && saveCardOnFile) {
      await emitSecurityEvent(
        "payment_method_added",
        { orderId: createdOrder.id, customerId: createdOrder.customerId },
        req
      );
    }

    return res.status(201).json({ order: createdOrder, registerSessionId: session.id });
  } catch (error) {
    if (error instanceof TransactionError) {
      if (config.observabilityMetricsEnabled) {
        incrementMetric("payment_failures_total", { reason: error.code || "transaction_error" });
      }
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }

    if (error instanceof InsufficientStockError) {
      await emitSecurityEvent(
        "suspicious_inventory_negative_attempt",
        { productId: error.product?.id, productName: error.product?.name },
        req
      );
      return res.status(409).json({ message: error.message });
    }

    if (error.code === "P2002") {
      return res.status(409).json({ message: "Duplicate payment token." });
    }

    return res.status(500).json({ message: "Failed to create order." });
  }
});

router.post("/suspended", requirePermission(permissions.SUSPENDED_SALE_MANAGE), async (req, res) => {
  const parsed = suspendSaleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid suspended sale payload." });
  }

  try {
    const session = await requireOpenRegisterSession(
      prisma,
      req.user.id,
      parsed.data.registerSessionId || null
    );
    const pricing = await resolvePricedItems(parsed.data.items);

    const suspendedSale = await prisma.suspendedSale.create({
      data: {
        cashierId: req.user.id,
        registerSessionId: session.id,
        customerId: parsed.data.customerId || null,
        status: "ACTIVE",
        note: parsed.data.note || null,
        payload: {
          items: parsed.data.items
        },
        subtotalCents: pricing.subtotalCents,
        taxCents: pricing.taxCents,
        totalCents: pricing.totalCents
      }
    });

    if (config.observabilityMetricsEnabled) {
      incrementMetric("suspended_sales_total", { status: "ACTIVE" });
    }
    await emitSecurityEvent(
      "sale_suspended",
      { suspendedSaleId: suspendedSale.id, registerSessionId: session.id, totalCents: suspendedSale.totalCents },
      req
    );

    return res.status(201).json({ suspendedSale });
  } catch (error) {
    if (error instanceof TransactionError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: "Failed to suspend sale." });
  }
});

router.get("/suspended", requirePermission(permissions.SUSPENDED_SALE_MANAGE), async (req, res) => {
  try {
    const session = await requireOpenRegisterSession(prisma, req.user.id);
    const items = await prisma.suspendedSale.findMany({
      where: {
        cashierId: req.user.id,
        registerSessionId: session.id,
        status: { in: ["ACTIVE", "RESUMED"] }
      },
      orderBy: { suspendedAt: "desc" }
    });
    return res.json({ items });
  } catch (error) {
    if (error instanceof TransactionError) {
      if (error.code === "INVALID_STATE") {
        return res.json({ items: [] });
      }
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: "Failed to load suspended sales." });
  }
});

router.post("/suspended/:id/resume", requirePermission(permissions.SUSPENDED_SALE_MANAGE), async (req, res) => {
  const suspendedSaleId = Number(req.params.id);
  if (!Number.isInteger(suspendedSaleId) || suspendedSaleId <= 0) {
    return res.status(400).json({ message: "Invalid suspended sale id." });
  }

  try {
    await requireOpenRegisterSession(prisma, req.user.id);

    const sale = await prisma.suspendedSale.findFirst({
      where: { id: suspendedSaleId, cashierId: req.user.id }
    });
    if (!sale) {
      return res.status(404).json({ message: "Suspended sale not found." });
    }
    if (!["ACTIVE", "RESUMED"].includes(sale.status)) {
      return res.status(409).json({ message: "Suspended sale cannot be resumed." });
    }

    const updated = await prisma.suspendedSale.update({
      where: { id: sale.id },
      data: { status: "RESUMED", resumedAt: new Date() }
    });
    const payloadItems = Array.isArray(updated.payload?.items) ? updated.payload.items : [];
    const productIds = [...new Set(payloadItems.map((item) => item.productId).filter((value) => Number.isInteger(value)))];
    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds }, active: true }
        })
      : [];
    const byProductId = new Map(products.map((product) => [product.id, product]));
    const resumeCart = payloadItems
      .map((item) => {
        const product = byProductId.get(item.productId);
        if (!product) {
          return null;
        }
        return {
          product,
          quantity: item.quantity
        };
      })
      .filter(Boolean);

    if (config.observabilityMetricsEnabled) {
      incrementMetric("suspended_sales_total", { status: "RESUMED" });
    }
    await emitSecurityEvent("sale_resumed", { suspendedSaleId: updated.id }, req);

    return res.json({ suspendedSale: updated, resumeCart });
  } catch (error) {
    if (error instanceof TransactionError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code });
    }
    return res.status(500).json({ message: "Failed to resume suspended sale." });
  }
});

router.get("/", requirePermission(permissions.ORDER_READ_ALL), async (req, res) => {
  const where = buildOrderWhere(req.query);
  const { page, size, skip, take } = parsePageQuery(req.query);

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        cashier: {
          select: { id: true, username: true, role: true }
        },
        customer: {
          select: { id: true, name: true, email: true, phone: true }
        },
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take
    }),
    prisma.order.count({ where })
  ]);

  return res.json(createPageResult({ items: orders, page, size, total }));
});

router.get(
  "/:id",
  requireAnyPermission(permissions.ORDER_READ_OWN, permissions.ORDER_READ_ALL),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        cashier: { select: { id: true, username: true, role: true } },
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true
          }
        },
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, barcode: true }
            }
          }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (req.user.role === Role.CASHIER && order.cashierId !== req.user.id) {
      return res.status(403).json({ message: "You can only view your own orders." });
    }

    return res.json({ order });
  }
);

router.post(
  "/:id/void",
  requireAnyPermission(permissions.ORDER_VOID_OWN, permissions.ORDER_VOID_ANY),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid order id." });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found." });
    }

    if (req.user.role === Role.CASHIER && order.cashierId !== req.user.id) {
      return res.status(403).json({ message: "You can only void your own orders." });
    }

    if (order.status === OrderStatus.VOIDED) {
      return res.status(409).json({ message: "Order is already voided." });
    }

    const ageMinutes = (Date.now() - order.createdAt.getTime()) / (1000 * 60);
    if (ageMinutes > config.voidWindowMinutes) {
      return res.status(400).json({
        message: `Order cannot be voided after ${config.voidWindowMinutes} minutes.`
      });
    }

    const updatedOrder = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { inventoryCount: { increment: item.quantity } }
        });
      }

      return tx.order.update({
        where: { id },
        data: { status: OrderStatus.VOIDED },
        include: {
          cashier: { select: { id: true, username: true, role: true } },
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              createdAt: true
            }
          },
          items: {
            include: {
              product: {
                select: { id: true, name: true, sku: true }
              }
            }
          }
        }
      });
    });

    await emitSecurityEvent("order_voided", { orderId: id, previousStatus: order.status }, req);
    if (config.observabilityMetricsEnabled) {
      incrementMetric("refunds_issued_total", { type: "void_order" });
    }
    return res.json({ order: updatedOrder });
  }
);

router.post("/:id/print", requireAnyPermission(permissions.ORDER_READ_OWN, permissions.ORDER_READ_ALL), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid order id." });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      cashier: { select: { id: true, username: true, role: true } },
      customer: { select: { id: true, name: true } },
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, barcode: true }
          }
        }
      }
    }
  });

  if (!order) {
    return res.status(404).json({ message: "Order not found." });
  }

  if (req.user.role === Role.CASHIER && order.cashierId !== req.user.id) {
    return res.status(403).json({ message: "You can only print your own orders." });
  }

  const printJob = createPrintJob(order, req.user.id, req.requestId);
  if (config.observabilityMetricsEnabled) {
    incrementMetric("receipt_print_total", { status: order.status });
  }
  await emitSecurityEvent("receipt_printed", { orderId: order.id, printJobId: printJob.id }, req);

  return res.status(201).json({ printJob });
});

router.get("/print/jobs", requirePermission(permissions.ORDER_READ_ALL), async (_req, res) => {
  return res.json({ items: listPrintJobs() });
});

export default router;

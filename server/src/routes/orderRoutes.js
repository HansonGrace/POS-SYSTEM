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
import { generatePaymentToken } from "../security/paymentTokens.js";

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

router.post("/", requirePermission(permissions.ORDER_CREATE), async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid order payload." });
  }

  const { items, paymentType, customerId, saveCardOnFile, card } = parsed.data;
  const uniqueProductIds = [...new Set(items.map((item) => item.productId))];

  const products = await prisma.product.findMany({
    where: { id: { in: uniqueProductIds }, active: true },
    select: { id: true, name: true, priceCents: true, inventoryCount: true, active: true }
  });

  if (products.length !== uniqueProductIds.length) {
    return res.status(400).json({ message: "One or more products are unavailable." });
  }

  const byId = new Map(products.map((product) => [product.id, product]));
  const normalizedItems = [];
  let subtotalCents = 0;

  for (const item of items) {
    const product = byId.get(item.productId);
    if (!product) {
      return res.status(400).json({ message: "Invalid product in cart." });
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

  const taxCents = computeTax(subtotalCents, config.taxRate);
  const totalCents = subtotalCents + taxCents;

  try {
    const createdOrder = await prisma.$transaction(async (tx) => {
      for (const item of normalizedItems) {
        const updated = await tx.product.updateMany({
          where: {
            id: item.productId,
            active: true,
            inventoryCount: { gte: item.quantity }
          },
          data: { inventoryCount: { decrement: item.quantity } }
        });

        if (updated.count !== 1) {
          const conflictedProduct = byId.get(item.productId);
          throw new InsufficientStockError(
            `Insufficient inventory for ${conflictedProduct?.name || "product"}.`,
            conflictedProduct
          );
        }
      }

      if (paymentType === PaymentType.CARD && saveCardOnFile) {
        if (!customerId || !card) {
          throw new Error("Customer and card fields are required when saving card on file.");
        }

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

      return tx.order.create({
        data: {
          cashierId: req.user.id,
          customerId: customerId || null,
          subtotalCents,
          taxCents,
          totalCents,
          status: OrderStatus.COMPLETED,
          paymentType,
          items: {
            createMany: {
              data: normalizedItems
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
    });

    await emitSecurityEvent(
      "order_created",
      { orderId: createdOrder.id, paymentType, totalCents: createdOrder.totalCents },
      req
    );

    if (paymentType === PaymentType.CARD && saveCardOnFile) {
      await emitSecurityEvent(
        "payment_method_added",
        { orderId: createdOrder.id, customerId: createdOrder.customerId },
        req
      );
    }

    return res.status(201).json({ order: createdOrder });
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      await emitSecurityEvent(
        "suspicious_inventory_negative_attempt",
        { productId: error.product?.id, productName: error.product?.name },
        req
      );
      return res.status(409).json({ message: error.message });
    }

    if (error.message?.includes("Customer and card fields are required")) {
      return res.status(400).json({ message: error.message });
    }

    if (error.code === "P2002") {
      return res.status(409).json({ message: "Duplicate payment token." });
    }

    return res.status(500).json({ message: "Failed to create order." });
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
    return res.json({ order: updatedOrder });
  }
);

export default router;

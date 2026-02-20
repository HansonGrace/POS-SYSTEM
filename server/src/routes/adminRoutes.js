import { Router } from "express";
import { OrderStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { parsePageQuery, createPageResult } from "../utils/pagination.js";

const router = Router();

function startOfToday() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfLast7Days() {
  const start = startOfToday();
  start.setDate(start.getDate() - 6);
  return start;
}

router.get("/metrics", requirePermission(permissions.METRICS_READ), async (_req, res) => {
  const todayStart = startOfToday();
  const weekStart = startOfLast7Days();
  const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    todayAgg,
    weekAgg,
    todayCount,
    weekCount,
    topRaw,
    usersTotal,
    usersActive,
    productsTotal,
    productsActive,
    customersTotal,
    failedLogins24h,
    lockouts24h
  ] = await Promise.all([
    prisma.order.aggregate({
      where: { status: OrderStatus.COMPLETED, createdAt: { gte: todayStart } },
      _sum: { totalCents: true }
    }),
    prisma.order.aggregate({
      where: { status: OrderStatus.COMPLETED, createdAt: { gte: weekStart } },
      _sum: { totalCents: true }
    }),
    prisma.order.count({
      where: { status: OrderStatus.COMPLETED, createdAt: { gte: todayStart } }
    }),
    prisma.order.count({
      where: { status: OrderStatus.COMPLETED, createdAt: { gte: weekStart } }
    }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        order: {
          status: OrderStatus.COMPLETED,
          createdAt: { gte: weekStart }
        }
      },
      _sum: { quantity: true, lineTotalCents: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5
    }),
    prisma.user.count(),
    prisma.user.count({ where: { active: true } }),
    prisma.product.count(),
    prisma.product.count({ where: { active: true } }),
    prisma.customer.count(),
    prisma.auditLog.count({
      where: { action: "auth_login_failed", createdAt: { gte: past24h } }
    }),
    prisma.auditLog.count({
      where: { action: "auth_account_locked", createdAt: { gte: past24h } }
    })
  ]);

  const productIds = topRaw.map((row) => row.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true }
      })
    : [];
  const byProductId = new Map(products.map((product) => [product.id, product]));

  const topSellingItems = topRaw.map((row) => ({
    productId: row.productId,
    productName: byProductId.get(row.productId)?.name || "Unknown Product",
    sku: byProductId.get(row.productId)?.sku || "n/a",
    quantitySold: row._sum.quantity || 0,
    revenueCents: row._sum.lineTotalCents || 0
  }));

  return res.json({
    metrics: {
      totalSalesTodayCents: todayAgg._sum.totalCents || 0,
      totalSales7DaysCents: weekAgg._sum.totalCents || 0,
      ordersToday: todayCount,
      orders7Days: weekCount,
      topSellingItems,
      totals: {
        users: usersTotal,
        activeUsers: usersActive,
        disabledUsers: usersTotal - usersActive,
        products: productsTotal,
        activeProducts: productsActive,
        customers: customersTotal
      },
      security: {
        failedLogins24h,
        lockouts24h
      }
    }
  });
});

router.get("/audit-logs", requirePermission(permissions.AUDIT_READ), async (req, res) => {
  const { page, size, skip, take } = parsePageQuery(req.query);
  const where = {};

  if (typeof req.query.category === "string" && req.query.category.trim()) {
    where.category = req.query.category.trim();
  }
  if (typeof req.query.severity === "string" && req.query.severity.trim()) {
    where.severity = req.query.severity.trim();
  }
  if (typeof req.query.action === "string" && req.query.action.trim()) {
    where.action = req.query.action.trim();
  }
  if (typeof req.query.actorId === "string" && req.query.actorId.trim()) {
    const actorId = Number(req.query.actorId);
    if (Number.isInteger(actorId)) {
      where.actorId = actorId;
    }
  }

  const [auditLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip,
      take
    }),
    prisma.auditLog.count({ where })
  ]);

  return res.json(createPageResult({ items: auditLogs, page, size, total }));
});

export default router;

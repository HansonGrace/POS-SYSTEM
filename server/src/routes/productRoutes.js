import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { parsePageQuery, createPageResult } from "../utils/pagination.js";
import { emitSecurityEvent } from "../security/events.js";

const router = Router();

const createProductSchema = z.object({
  name: z.string().trim().min(2),
  sku: z.string().trim().min(2),
  barcode: z.string().trim().min(3).optional().nullable(),
  category: z.string().trim().min(2),
  priceCents: z.number().int().min(0),
  inventoryCount: z.number().int().min(0),
  active: z.boolean().optional().default(true)
});

const updateProductSchema = createProductSchema.partial();

router.get("/", requirePermission(permissions.PRODUCT_READ), async (req, res) => {
  const { q, category } = req.query;
  const activeQuery = req.query.active;
  const { page, size, skip, take } = parsePageQuery(req.query);
  const where = {};

  if (typeof activeQuery === "string") {
    where.active = activeQuery === "true";
  }

  if (typeof category === "string" && category.trim()) {
    where.category = category.trim();
  }

  if (typeof q === "string" && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name: { contains: term } },
      { category: { contains: term } },
      { sku: { contains: term } },
      { barcode: { contains: term } }
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      skip,
      take
    }),
    prisma.product.count({ where })
  ]);

  return res.json(createPageResult({ items: products, page, size, total }));
});

router.post("/", requirePermission(permissions.PRODUCT_WRITE), async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid product payload." });
  }

  try {
    const product = await prisma.product.create({
      data: {
        ...parsed.data,
        barcode: parsed.data.barcode || null
      }
    });

    await emitSecurityEvent(
      "product_created",
      { productId: product.id, sku: product.sku, name: product.name },
      req
    );

    return res.status(201).json({ product });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({ message: "SKU or barcode already exists." });
    }

    return res.status(500).json({ message: "Failed to create product." });
  }
});

router.put("/:id", requirePermission(permissions.PRODUCT_WRITE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid product id." });
  }

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid product payload." });
  }

  try {
    const product = await prisma.product.update({
      where: { id },
      data: parsed.data
    });

    await emitSecurityEvent("product_updated", { productId: id }, req);
    return res.json({ product });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Product not found." });
    }
    if (error.code === "P2002") {
      return res.status(409).json({ message: "SKU or barcode already exists." });
    }
    return res.status(500).json({ message: "Failed to update product." });
  }
});

router.delete("/:id", requirePermission(permissions.PRODUCT_WRITE), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid product id." });
  }

  try {
    const product = await prisma.product.update({
      where: { id },
      data: { active: false }
    });

    await emitSecurityEvent("product_deactivated", { productId: id }, req);
    return res.json({ product });
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Product not found." });
    }
    return res.status(500).json({ message: "Failed to deactivate product." });
  }
});

export default router;

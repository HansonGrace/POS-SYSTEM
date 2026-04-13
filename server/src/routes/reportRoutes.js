import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import { config } from "../config.js";
import { emitSecurityEvent } from "../security/events.js";

const router = Router();

//SQL Injection in product search reporting endpoint
// This endpoint uses raw SQL with string concatenation instead of
// parameterized queries. An attacker can inject SQL via the `q` parameter.
//
//   GET /api/reports/products?q=' UNION SELECT username,passwordHash,role,1,1,1 FROM User--
//   GET /api/reports/products?q=' OR 1=1--
router.get("/products", requireAuth, async (req, res) => {
  const searchTerm = req.query.q || "";
  const category = req.query.category || "";

  try {
    let query = `SELECT id, name, sku, category, priceCents, inventoryCount FROM Product WHERE active = 1`;

    if (searchTerm) {
      query += ` AND (name LIKE '%${searchTerm}%' OR sku LIKE '%${searchTerm}%' OR barcode LIKE '%${searchTerm}%')`;
    }

    if (category) {
      query += ` AND category = '${category}'`;
    }

    query += ` ORDER BY name ASC LIMIT 100`;

    const results = await prisma.$queryRawUnsafe(query);

    await emitSecurityEvent("report_product_search", {
      searchTerm,
      category,
      resultCount: results.length
    }, req);

    return res.json({ items: results });
  } catch (error) {
    // VULNERABILITY: Verbose error messages leak database structure
    return res.status(500).json({
      message: "Report query failed.",
      error: error.message,
      query: config.labMode ? `Failed query context: search=${searchTerm}` : undefined
    });
  }
});

//SQL Injection in sales summary reporting
// The date parameters are directly concatenated into the SQL query.
//   GET /api/reports/sales?startDate=2024-01-01' UNION SELECT username,passwordHash,role,1 FROM User--
router.get("/sales", requireAuth, async (req, res) => {
  const startDate = req.query.startDate || "2000-01-01";
  const endDate = req.query.endDate || new Date().toISOString().split("T")[0];

  try {
    //Raw SQL with direct string interpolation
    const query = `
      SELECT
        date(createdAt) as saleDate,
        COUNT(*) as orderCount,
        SUM(totalCents) as totalRevenueCents
      FROM "Order"
      WHERE status = 'COMPLETED'
        AND createdAt >= '${startDate}'
        AND createdAt <= '${endDate} 23:59:59'
      GROUP BY date(createdAt)
      ORDER BY saleDate DESC
      LIMIT 90
    `;

    const results = await prisma.$queryRawUnsafe(query);

    return res.json({ items: results });
  } catch (error) {
    return res.status(500).json({
      message: "Sales report failed.",
      error: error.message
    });
  }
});

export default router;

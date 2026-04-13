import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { emitSecurityEvent } from "../security/events.js";

const router = Router();

// -----------------------------------------------------------------------
// VULNERABILITY: IDOR (Insecure Direct Object Reference)
// -----------------------------------------------------------------------
// These endpoints allow any authenticated user to access ANY receipt,
// order, or customer record by simply changing the ID in the URL.
// No ownership validation is performed.
//
// Example exploits:
//   - Cashier user1 can access user2's receipts: GET /api/receipts/1, /api/receipts/2, etc.
//   - Sequential ID enumeration reveals all orders in the system
//   - Customer PII (name, email, phone, payment methods) is exposed
//
// A proper implementation would check that the requesting user owns
// the resource or has admin privileges.
// -----------------------------------------------------------------------

// Any authenticated user can look up any order by ID (no ownership check)
router.get("/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Invalid receipt id." });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      cashier: {
        select: { id: true, username: true, role: true }
      },
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          // VULNERABLE: Exposing payment methods for any customer
          paymentMethods: true
        }
      },
      items: {
        include: {
          product: {
            select: { id: true, name: true, sku: true, barcode: true, priceCents: true }
          }
        }
      }
    }
  });

  if (!order) {
    return res.status(404).json({ message: "Receipt not found." });
  }

  // NOTE: No ownership check here! Any authenticated user can view any receipt.
  // Should check: if (req.user.role !== 'ADMIN' && order.cashierId !== req.user.id)

  await emitSecurityEvent("receipt_viewed", {
    orderId: id,
    viewerId: req.user.id,
    viewerRole: req.user.role,
    orderOwnerId: order.cashierId
  }, req);

  return res.json({ receipt: order });
});

// IDOR: Bulk customer lookup - any authenticated user can list all customers with PII
router.get("/customers/lookup", requireAuth, async (req, res) => {
  const email = req.query.email || "";
  const phone = req.query.phone || "";

  const where = {};
  if (email) {
    where.email = { contains: email };
  }
  if (phone) {
    where.phone = { contains: phone };
  }

  const customers = await prisma.customer.findMany({
    where,
    include: {
      // VULNERABLE: Exposes all payment methods including tokens
      paymentMethods: true,
      orders: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, priceCents: true } }
            }
          }
        }
      }
    },
    take: 50
  });

  await emitSecurityEvent("customer_bulk_lookup", {
    searchEmail: email,
    searchPhone: phone,
    resultCount: customers.length,
    actorId: req.user.id
  }, req);

  return res.json({ customers });
});

export default router;

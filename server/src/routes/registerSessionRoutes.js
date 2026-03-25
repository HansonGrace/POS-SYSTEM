import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { permissions } from "../auth/permissions.js";
import {
  closeRegisterSession,
  listDrawerEvents,
  openRegisterSession,
  recordCashDrawerEvent,
  requireOpenRegisterSession
} from "../services/core/registerWorkflowService.js";
import { TransactionError } from "../services/core/errors.js";
import { emitSecurityEvent } from "../security/events.js";
import { incrementMetric } from "../observability/metrics.js";
import { config } from "../config.js";

const router = Router();

const openSessionSchema = z.object({
  registerId: z.number().int().positive(),
  startingBalanceCents: z.number().int().nonnegative().optional().default(0),
  notes: z.string().trim().max(320).optional()
});

const closeSessionSchema = z.object({
  endingBalanceCents: z.number().int().nonnegative().optional(),
  notes: z.string().trim().max(320).optional()
});

const drawerEventSchema = z.object({
  type: z.enum(["OPEN_FLOAT", "CASH_DROP", "CASH_PICKUP", "NO_SALE", "ADJUSTMENT", "COUNT"]),
  amountCents: z.number().int().optional().default(0),
  reason: z.string().trim().max(320).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function parseSessionId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function handleError(error, res) {
  if (error instanceof TransactionError) {
    return res.status(error.statusCode).json({ message: error.message, code: error.code });
  }
  return res.status(500).json({ message: "Register workflow failed." });
}

router.get("/current", requirePermission(permissions.REGISTER_SESSION_READ), async (req, res) => {
  try {
    const session = await requireOpenRegisterSession(prisma, req.user.id);
    return res.json({ session });
  } catch (error) {
    if (error instanceof TransactionError && error.code === "INVALID_STATE") {
      return res.json({ session: null });
    }
    return handleError(error, res);
  }
});

router.post("/open", requirePermission(permissions.REGISTER_SESSION_MANAGE), async (req, res) => {
  const parsed = openSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid register open payload." });
  }

  try {
    const session = await openRegisterSession(prisma, {
      actorId: req.user.id,
      registerId: parsed.data.registerId,
      startingBalanceCents: parsed.data.startingBalanceCents,
      notes: parsed.data.notes || null
    });

    if (config.observabilityMetricsEnabled) {
      incrementMetric("register_session_open_total", { registerId: session.registerId });
    }
    await emitSecurityEvent(
      "register_session_opened",
      { registerSessionId: session.id, registerId: session.registerId },
      req
    );

    return res.status(201).json({ session });
  } catch (error) {
    return handleError(error, res);
  }
});

router.post("/:id/close", requirePermission(permissions.REGISTER_SESSION_MANAGE), async (req, res) => {
  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ message: "Invalid register session id." });
  }

  const parsed = closeSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid register close payload." });
  }

  try {
    const session = await closeRegisterSession(prisma, {
      actorId: req.user.id,
      sessionId,
      endingBalanceCents: parsed.data.endingBalanceCents ?? null,
      notes: parsed.data.notes || null
    });

    if (config.observabilityMetricsEnabled) {
      incrementMetric("register_session_close_total", { registerId: session.registerId });
    }
    await emitSecurityEvent(
      "register_session_closed",
      {
        registerSessionId: session.id,
        registerId: session.registerId,
        endingBalanceCents: parsed.data.endingBalanceCents ?? null
      },
      req
    );

    return res.json({ session });
  } catch (error) {
    return handleError(error, res);
  }
});

router.post("/:id/drawer-events", requirePermission(permissions.REGISTER_SESSION_MANAGE), async (req, res) => {
  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ message: "Invalid register session id." });
  }

  const parsed = drawerEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid drawer event payload." });
  }

  try {
    const event = await recordCashDrawerEvent(prisma, {
      actorId: req.user.id,
      registerSessionId: sessionId,
      type: parsed.data.type,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason || null,
      metadata: parsed.data.metadata || null
    });

    if (config.observabilityMetricsEnabled) {
      incrementMetric("cash_drawer_event_total", {
        type: event.type
      });
    }

    await emitSecurityEvent(
      "register_cash_drawer_event",
      {
        registerSessionId: sessionId,
        drawerEventId: event.id,
        type: event.type,
        amountCents: event.amountCents
      },
      req
    );

    return res.status(201).json({ event });
  } catch (error) {
    return handleError(error, res);
  }
});

router.get("/:id/drawer-events", requirePermission(permissions.REGISTER_SESSION_READ), async (req, res) => {
  const sessionId = parseSessionId(req.params.id);
  if (!sessionId) {
    return res.status(400).json({ message: "Invalid register session id." });
  }

  try {
    const events = await listDrawerEvents(prisma, req.user.id, sessionId);
    return res.json({ items: events });
  } catch (error) {
    return handleError(error, res);
  }
});

export default router;

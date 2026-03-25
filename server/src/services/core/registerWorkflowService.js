import { RegisterSessionStatus } from "@prisma/client";
import { TransactionError } from "./errors.js";
import { resolveActiveUser } from "./userContextService.js";

export async function requireOpenRegisterSession(prisma, actorId, registerSessionId = null) {
  const where = registerSessionId
    ? { id: registerSessionId }
    : {
        cashierId: actorId,
        status: RegisterSessionStatus.OPEN
      };

  const session = await prisma.registerSession.findFirst({
    where,
    include: {
      register: {
        select: {
          id: true,
          identifier: true,
          name: true,
          active: true
        }
      }
    },
    orderBy: { openedAt: "desc" }
  });

  if (!session) {
    throw new TransactionError("INVALID_STATE", "an open register session is required", 409);
  }

  if (session.cashierId !== actorId) {
    throw new TransactionError("FORBIDDEN", "register session is owned by another cashier", 403);
  }

  if (!session.register?.active) {
    throw new TransactionError("INVALID_STATE", "register is inactive", 409);
  }

  return session;
}

export async function openRegisterSession(prisma, { actorId, registerId, startingBalanceCents = 0, notes = null }) {
  const actor = await resolveActiveUser(prisma, actorId);
  if (!actor) {
    throw new TransactionError("NOT_AUTHENTICATED", "authentication required", 401);
  }

  if (startingBalanceCents < 0) {
    throw new TransactionError("INVALID_INPUT", "starting balance must be non-negative", 400);
  }

  const register = await prisma.register.findUnique({
    where: { id: registerId },
    select: { id: true, active: true }
  });
  if (!register || !register.active) {
    throw new TransactionError("NOT_FOUND", "active register not found", 404);
  }

  const existing = await prisma.registerSession.findFirst({
    where: {
      cashierId: actorId,
      status: RegisterSessionStatus.OPEN
    },
    orderBy: { openedAt: "desc" }
  });
  if (existing) {
    throw new TransactionError("INVALID_STATE", "cashier already has an open register session", 409);
  }

  return prisma.registerSession.create({
    data: {
      registerId,
      cashierId: actorId,
      status: RegisterSessionStatus.OPEN,
      startingBalanceCents,
      notes
    },
    include: {
      register: {
        select: {
          id: true,
          identifier: true,
          name: true
        }
      },
      cashier: {
        select: {
          id: true,
          username: true,
          role: true
        }
      }
    }
  });
}

export async function closeRegisterSession(
  prisma,
  { actorId, sessionId, endingBalanceCents = null, notes = null }
) {
  const actor = await resolveActiveUser(prisma, actorId);
  if (!actor) {
    throw new TransactionError("NOT_AUTHENTICATED", "authentication required", 401);
  }

  const session = await prisma.registerSession.findUnique({
    where: { id: sessionId },
    include: {
      register: {
        select: {
          id: true,
          identifier: true,
          name: true
        }
      }
    }
  });

  if (!session) {
    throw new TransactionError("NOT_FOUND", "register session not found", 404);
  }
  if (session.cashierId !== actorId) {
    throw new TransactionError("FORBIDDEN", "you can only close your own register session", 403);
  }
  if (session.status !== RegisterSessionStatus.OPEN) {
    throw new TransactionError("INVALID_STATE", "register session is not open", 409);
  }
  if (endingBalanceCents !== null && endingBalanceCents < 0) {
    throw new TransactionError("INVALID_INPUT", "ending balance must be non-negative", 400);
  }

  return prisma.registerSession.update({
    where: { id: sessionId },
    data: {
      status: RegisterSessionStatus.CLOSED,
      closedAt: new Date(),
      endingBalanceCents,
      notes: notes || session.notes
    },
    include: {
      register: {
        select: {
          id: true,
          identifier: true,
          name: true
        }
      },
      cashier: {
        select: {
          id: true,
          username: true,
          role: true
        }
      }
    }
  });
}

export async function recordCashDrawerEvent(
  prisma,
  { actorId, registerSessionId, type, amountCents = 0, reason = null, metadata = null }
) {
  await requireOpenRegisterSession(prisma, actorId, registerSessionId);

  if (!type || typeof type !== "string") {
    throw new TransactionError("INVALID_INPUT", "drawer event type is required", 400);
  }
  if (!Number.isInteger(amountCents)) {
    throw new TransactionError("INVALID_INPUT", "drawer event amount must be an integer", 400);
  }

  return prisma.cashDrawerEvent.create({
    data: {
      registerSessionId,
      cashierId: actorId,
      type,
      amountCents,
      reason,
      metadata
    }
  });
}

export async function listDrawerEvents(prisma, actorId, registerSessionId) {
  const session = await requireOpenRegisterSession(prisma, actorId, registerSessionId);
  return prisma.cashDrawerEvent.findMany({
    where: { registerSessionId: session.id },
    orderBy: { createdAt: "desc" }
  });
}

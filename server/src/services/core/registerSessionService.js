import { RegisterSessionStatus } from "@prisma/client";
import { TransactionError } from "./errors.js";

export async function getOpenRegisterSession(tx, { actorId, registerId, registerSessionId }) {
  if (registerSessionId !== undefined) {
    const session = await tx.registerSession.findUnique({
      where: { id: registerSessionId },
      select: {
        id: true,
        registerId: true,
        cashierId: true,
        status: true
      }
    });

    if (!session) {
      throw new TransactionError("NOT_FOUND", "register session not found", 404);
    }

    if (session.cashierId !== actorId) {
      throw new TransactionError("FORBIDDEN", "register session is not owned by the current user", 403);
    }

    if (session.status !== RegisterSessionStatus.OPEN) {
      throw new TransactionError("INVALID_STATE", "register session is not open", 409);
    }

    return session;
  }

  const register = registerId
    ? await tx.register.findUnique({
        where: { id: registerId },
        select: { id: true, identifier: true, active: true }
      })
    : await tx.register.findFirst({
        where: { active: true },
        select: { id: true, identifier: true, active: true },
        orderBy: { id: "asc" }
      });

  if (!register || !register.active) {
    throw new TransactionError("NOT_FOUND", "active register not found", 404);
  }

  const existingSession = await tx.registerSession.findFirst({
    where: {
      registerId: register.id,
      cashierId: actorId,
      status: RegisterSessionStatus.OPEN
    },
    orderBy: { openedAt: "desc" },
    select: { id: true }
  });

  if (existingSession) {
    return existingSession;
  }

  return tx.registerSession.create({
    data: {
      registerId: register.id,
      cashierId: actorId,
      status: RegisterSessionStatus.OPEN
    },
    select: { id: true }
  });
}


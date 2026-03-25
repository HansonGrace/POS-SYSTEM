import { TransactionError } from "./errors.js";

const INACTIVE_USER_STATUS_ERROR = "USER_DISABLED";

export async function resolveActiveUser(prisma, actorId) {
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new TransactionError("INVALID_INPUT", "actorId must be a valid user id", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: actorId },
    select: {
      id: true,
      username: true,
      role: true,
      active: true
    }
  });

  if (!user) {
    throw new TransactionError("NOT_FOUND", "actor not found", 401);
  }

  if (!user.active) {
    throw new TransactionError(INACTIVE_USER_STATUS_ERROR, "actor is disabled", 403);
  }

  return user;
}


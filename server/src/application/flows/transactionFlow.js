import { prisma as defaultDb } from "../../db.js";
import { createTransactionReadRepository } from "../../persistence/transactionRepository.js";
import {
  createTransaction,
  addTransactionItems,
  finalizeTransaction,
  refundTransaction,
  getTransactionById,
  voidTransaction
} from "../../services/transactionService.js";

export function createTransactionFlow({ db = defaultDb } = {}) {
  const repository = createTransactionReadRepository(db);

  return {
    getTransactionById: (transactionId) => repository.getTransactionById(transactionId),
    createTransaction: (actorId, payload) => createTransaction(db, actorId, payload),
    addTransactionItems: (actorId, transactionId, payload) =>
      addTransactionItems(db, actorId, transactionId, payload),
    finalizeTransaction: (actorId, transactionId) => finalizeTransaction(db, actorId, transactionId),
    refundTransaction: (actorId, transactionId, payload) =>
      refundTransaction(db, actorId, transactionId, payload),
    voidTransaction: (actorId, transactionId, payload) => voidTransaction(db, actorId, transactionId, payload),
    // Keep legacy method for places that still need direct service-style query semantics.
    getTransactionByIdService: (id) => getTransactionById(db, id)
  };
}

export const transactionFlow = createTransactionFlow();

import { prisma as defaultDb } from "../db.js";
import { createTransactionFlow } from "./flows/transactionFlow.js";
import { createPaymentFlow } from "./flows/paymentFlow.js";
import { createTransactionReadRepository } from "../persistence/transactionRepository.js";

export function createApplicationContext({ db = defaultDb } = {}) {
  return {
    layers: {
      presentation: "express-route-handlers",
      application: "flow-services",
      persistence: "prisma-repository"
    },
    database: db,
    repositories: {
      transaction: createTransactionReadRepository(db)
    },
    flows: {
      transaction: createTransactionFlow({ db }),
      payment: createPaymentFlow({ db })
    }
  };
}

export const applicationContext = createApplicationContext();

import { prisma as defaultDb } from "../../db.js";
import {
  completePayment,
  startPayment,
  submitTransactionPayment,
  voidPayment,
  refundPayment
} from "../../services/payment/paymentOrchestrator.js";

export function createPaymentFlow({ db = defaultDb } = {}) {
  return {
    submitTransactionPayment: (actorId, transactionId, payload) =>
      submitTransactionPayment(db, actorId, transactionId, payload),
    startPayment: (actorId, transactionId, payload) =>
      startPayment(db, actorId, transactionId, payload),
    completePayment: (actorId, paymentId, metadata, transactionId) =>
      completePayment(db, actorId, paymentId, metadata, transactionId),
    voidPayment: (actorId, paymentId, metadata, transactionId) =>
      voidPayment(db, actorId, paymentId, metadata, transactionId),
    refundPayment: (actorId, paymentId, payload, transactionId) =>
      refundPayment(db, actorId, paymentId, payload, transactionId)
  };
}

export const paymentFlow = createPaymentFlow();

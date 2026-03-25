export const transactionIncludeGraph = {
  cashier: {
    select: {
      id: true,
      username: true,
      role: true
    }
  },
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true
    }
  },
  registerSession: {
    select: {
      id: true,
      status: true,
      openedAt: true,
      closedAt: true,
      register: {
        select: {
          id: true,
          identifier: true,
          name: true
        }
      }
    }
  },
  items: {
    orderBy: { lineNumber: "asc" }
  },
  discounts: {
    orderBy: { id: "asc" }
  },
  taxes: {
    orderBy: { id: "asc" }
  },
  payments: {
    orderBy: { createdAt: "asc" }
  },
  returns: {
    orderBy: { createdAt: "desc" }
  },
  refunds: {
    orderBy: { createdAt: "desc" }
  },
  statusHistory: {
    orderBy: { createdAt: "desc" }
  },
  receipt: true
};

export function createTransactionReadRepository(db) {
  return {
    async getTransactionById(transactionId) {
      return db.transaction.findUnique({
        where: { id: transactionId },
        include: transactionIncludeGraph
      });
    }
  };
}

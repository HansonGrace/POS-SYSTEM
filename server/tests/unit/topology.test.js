import test from "node:test";
import assert from "node:assert/strict";

import { createApplicationContext } from "../../src/application/container.js";
import { createApiRouter } from "../../src/presentation/http/api.js";

test("application composition exposes presentation, application, and persistence boundaries", () => {
  const appContext = createApplicationContext();

  assert.equal(appContext.layers.presentation, "express-route-handlers");
  assert.equal(appContext.layers.application, "flow-services");
  assert.equal(appContext.layers.persistence, "prisma-repository");

  assert.equal(typeof appContext.repositories.transaction.getTransactionById, "function");
  assert.equal(typeof appContext.flows.transaction.createTransaction, "function");
  assert.equal(typeof appContext.flows.payment.submitTransactionPayment, "function");
});

test("api composition mounts presentation routers under the /api namespace", () => {
  const apiRouter = createApiRouter({
    appConfig: { appVersion: "1.0.0" },
    db: { $queryRaw: async () => ({}) },
    logger: { warn() {} }
  });

  const mountedRouters = apiRouter.stack.filter((layer) => layer.name === "router").length;
  assert.equal(apiRouter.stack.length > 0, true);
  assert.equal(mountedRouters >= 7, true);
  assert.equal(apiRouter.stack.length >= 8, true);
});

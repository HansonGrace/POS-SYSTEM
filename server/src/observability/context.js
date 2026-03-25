import { AsyncLocalStorage } from "node:async_hooks";

const requestContextStorage = new AsyncLocalStorage();

export function runWithRequestContext(context, callback) {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext() {
  return requestContextStorage.getStore() || null;
}

export function setRequestContextValue(key, value) {
  const context = requestContextStorage.getStore();
  if (!context) {
    return;
  }

  context[key] = value;
}

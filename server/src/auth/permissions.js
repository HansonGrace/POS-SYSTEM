export const permissions = {
  CUSTOMER_READ_ALL: "CUSTOMER:READ_ALL",
  CUSTOMER_READ_DETAIL: "CUSTOMER:READ_DETAIL",
  CUSTOMER_SEARCH: "CUSTOMER:SEARCH",
  CUSTOMER_WRITE: "CUSTOMER:WRITE",
  PAYMENT_METHOD_CREATE: "PAYMENT_METHOD:CREATE",
  PAYMENT_METHOD_VIEW_TOKEN: "PAYMENT_METHOD:VIEW_TOKEN",
  PRODUCT_READ: "PRODUCT:READ",
  PRODUCT_WRITE: "PRODUCT:WRITE",
  ORDER_CREATE: "ORDER:CREATE",
  ORDER_READ_ALL: "ORDER:READ_ALL",
  ORDER_READ_OWN: "ORDER:READ_OWN",
  ORDER_VOID_ANY: "ORDER:VOID_ANY",
  ORDER_VOID_OWN: "ORDER:VOID_OWN",
  USER_MANAGE: "USER:MANAGE",
  AUDIT_READ: "AUDIT:READ",
  METRICS_READ: "METRICS:READ",
  CONFIG_READ: "CONFIG:READ"
};

const baseAdminPermissions = new Set(Object.values(permissions));
const cashierPermissions = new Set([
  permissions.CUSTOMER_SEARCH,
  permissions.PRODUCT_READ,
  permissions.ORDER_CREATE,
  permissions.ORDER_READ_OWN,
  permissions.ORDER_VOID_OWN,
  permissions.CONFIG_READ
]);

export const rolePermissionMap = {
  ADMIN: baseAdminPermissions,
  CASHIER: cashierPermissions
};

export function hasPermission(role, permission) {
  return rolePermissionMap[role]?.has(permission) ?? false;
}

const eventDefinitions = {
  auth_login_attempt: { severity: "info", category: "auth", alertClass: "auth" },
  auth_login_success: { severity: "info", category: "auth", alertClass: "auth" },
  auth_login_failed: { severity: "warning", category: "auth", alertClass: "auth" },
  auth_account_locked: { severity: "warning", category: "auth", alertClass: "security" },
  auth_logout: { severity: "info", category: "auth", alertClass: "auth" },
  lockout_disabled: { severity: "warning", category: "auth", alertClass: "security" },
  data_customers_list_access: { severity: "info", category: "data", alertClass: "data_access" },
  data_customer_detail_access: { severity: "info", category: "data", alertClass: "data_access" },
  data_customer_search: { severity: "info", category: "data", alertClass: "data_access" },
  data_customer_token_access: { severity: "warning", category: "data", alertClass: "data_access" },
  product_created: { severity: "info", category: "inventory", alertClass: "catalog" },
  product_updated: { severity: "info", category: "inventory", alertClass: "catalog" },
  product_deactivated: { severity: "warning", category: "inventory", alertClass: "catalog" },
  customer_created: { severity: "info", category: "customer", alertClass: "customer" },
  customer_updated: { severity: "info", category: "customer", alertClass: "customer" },
  order_created: { severity: "info", category: "transaction", alertClass: "sales" },
  order_voided: { severity: "warning", category: "transaction", alertClass: "sales" },
  transaction_created: { severity: "info", category: "transaction", alertClass: "sales" },
  transaction_finalized: { severity: "info", category: "transaction", alertClass: "sales" },
  transaction_refunded: { severity: "warning", category: "transaction", alertClass: "sales" },
  transaction_voided: { severity: "warning", category: "transaction", alertClass: "sales" },
  payment_method_added: { severity: "info", category: "transaction", alertClass: "payments" },
  payment_attempted: { severity: "info", category: "payments", alertClass: "payments" },
  payment_completed: { severity: "info", category: "payments", alertClass: "payments" },
  payment_failed: { severity: "warning", category: "payments", alertClass: "payments" },
  admin_user_created: { severity: "info", category: "admin", alertClass: "admin" },
  admin_user_updated: { severity: "info", category: "admin", alertClass: "admin" },
  admin_user_deleted: { severity: "warning", category: "admin", alertClass: "admin" },
  config_loaded: { severity: "info", category: "config", alertClass: "ops" },
  config_load_warning: { severity: "warning", category: "config", alertClass: "ops" },
  register_session_opened: { severity: "info", category: "register", alertClass: "ops" },
  register_session_closed: { severity: "info", category: "register", alertClass: "ops" },
  register_cash_drawer_event: { severity: "info", category: "register", alertClass: "ops" },
  sale_suspended: { severity: "info", category: "transaction", alertClass: "sales" },
  sale_resumed: { severity: "info", category: "transaction", alertClass: "sales" },
  receipt_printed: { severity: "info", category: "receipt", alertClass: "ops" },
  suspicious_rate_limit_hit: { severity: "warning", category: "threat", alertClass: "security" },
  suspicious_csrf_failure: { severity: "warning", category: "threat", alertClass: "security" },
  suspicious_inventory_negative_attempt: {
    severity: "warning",
    category: "threat",
    alertClass: "security"
  }
};

export function classifyEvent(eventType) {
  const definition = eventDefinitions[eventType] || {};
  return {
    severity: definition.severity || "info",
    category: definition.category || "app",
    alertClass: definition.alertClass || "general"
  };
}

export type Role = "ADMIN" | "CASHIER";

export type PaginatedResponse<T> = {
  items: T[];
  page: number;
  size: number;
  total?: number;
  totalPages?: number;
};

export type AuthUser = {
  id: number;
  username: string;
  role: Role;
};

export type Product = {
  id: number;
  name: string;
  sku: string;
  barcode: string | null;
  category: string;
  priceCents: number;
  inventoryCount: number;
  active: boolean;
  createdAt: string;
};

export type Customer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  paymentMethods?: PaymentMethod[];
};

export type PaymentMethod = {
  id: number;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  token?: string;
  createdAt: string;
};

export type OrderItem = {
  id: number;
  orderId: number;
  productId: number;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  product: {
    id: number;
    name: string;
    sku: string;
    barcode?: string | null;
  };
};

export type Order = {
  id: number;
  cashierId: number;
  customerId: number | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: "COMPLETED" | "VOIDED";
  paymentType: "CASH" | "CARD";
  createdAt: string;
  cashier: {
    id: number;
    username: string;
    role: Role;
  };
  customer: Customer | null;
  items: OrderItem[];
};

export type Metrics = {
  totalSalesTodayCents: number;
  totalSales7DaysCents: number;
  ordersToday: number;
  orders7Days: number;
  topSellingItems: Array<{
    productId: number;
    productName: string;
    sku: string;
    quantitySold: number;
    revenueCents: number;
  }>;
  totals: {
    users: number;
    activeUsers: number;
    disabledUsers: number;
    products: number;
    activeProducts: number;
    customers: number;
  };
  security: {
    failedLogins24h: number;
    lockouts24h: number;
  };
};

export type UserRow = {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
  failedLogins: number;
  lockedUntil?: string | null;
  lastFailedLoginAt?: string | null;
};

export type AuditLogRow = {
  id: number;
  actorId: number | null;
  action: string;
  metadata: Record<string, unknown> | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  severity: string;
  category: string;
  createdAt: string;
  actor: {
    id: number;
    username: string;
    role: Role;
  } | null;
};

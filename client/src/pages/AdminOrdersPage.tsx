import { useEffect, useState } from "react";
import { api, formatCents } from "../api";
import type { Order, PaginatedResponse, UserRow } from "../types";

type Filters = {
  startDate: string;
  endDate: string;
  cashierId: string;
  status: "" | "COMPLETED" | "VOIDED";
};

const initialFilters: Filters = {
  startDate: "",
  endDate: "",
  cashierId: "",
  status: ""
};

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [cashiers, setCashiers] = useState<UserRow[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadCashiers = async () => {
    try {
      const response = await api.get<PaginatedResponse<UserRow>>("/api/users?size=100");
      setCashiers(response.items.filter((user) => user.role === "CASHIER"));
    } catch {
      setCashiers([]);
    }
  };

  const loadOrders = async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set("startDate", filters.startDate);
      if (filters.endDate) params.set("endDate", filters.endDate);
      if (filters.cashierId) params.set("cashierId", filters.cashierId);
      if (filters.status) params.set("status", filters.status);

      const query = params.toString();
      const prefix = query ? `${query}&` : "";
      const response = await api.get<PaginatedResponse<Order>>(`/api/orders?${prefix}size=100`);
      setOrders(response.items);
      setSelectedOrder(response.items[0] || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load orders.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCashiers();
  }, []);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  return (
    <div className="admin-page-grid">
      <section className="panel">
        <h2>Orders</h2>

        <div className="filters-row">
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))}
          />
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))}
          />
          <select
            value={filters.cashierId}
            onChange={(event) => setFilters((prev) => ({ ...prev, cashierId: event.target.value }))}
          >
            <option value="">All cashiers</option>
            {cashiers.map((cashier) => (
              <option key={cashier.id} value={cashier.id}>
                {cashier.username}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                status: event.target.value as Filters["status"]
              }))
            }
          >
            <option value="">All statuses</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="VOIDED">VOIDED</option>
          </select>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        {loading ? (
          <div className="empty-state">Loading orders...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state">No orders found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Timestamp</th>
                <th>Cashier</th>
                <th>Status</th>
                <th>Payment</th>
                <th>Total</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{new Date(order.createdAt).toLocaleString()}</td>
                  <td>{order.cashier.username}</td>
                  <td>{order.status}</td>
                  <td>{order.paymentType}</td>
                  <td>{formatCents(order.totalCents)}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedOrder(order)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Order Detail</h2>

        {!selectedOrder ? (
          <div className="empty-state">Select an order to view details.</div>
        ) : (
          <>
            <p>
              <strong>Order ID:</strong> {selectedOrder.id}
            </p>
            <p>
              <strong>Cashier:</strong> {selectedOrder.cashier.username}
            </p>
            <p>
              <strong>Status:</strong> {selectedOrder.status}
            </p>
            <p>
              <strong>Payment:</strong> {selectedOrder.paymentType}
            </p>
            <p>
              <strong>Customer:</strong> {selectedOrder.customer?.name || "Walk-in"}
            </p>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.product.name}</td>
                    <td>{item.quantity}</td>
                    <td>{formatCents(item.unitPriceCents)}</td>
                    <td>{formatCents(item.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="totals-box">
              <div>
                <span>Subtotal</span>
                <strong>{formatCents(selectedOrder.subtotalCents)}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{formatCents(selectedOrder.taxCents)}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{formatCents(selectedOrder.totalCents)}</strong>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

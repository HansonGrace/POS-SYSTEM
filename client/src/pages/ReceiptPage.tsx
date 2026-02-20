import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatCents } from "../api";
import type { Order } from "../types";

export default function ReceiptPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadOrder = async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await api.get<{ order: Order }>(`/api/orders/${id}`);
      setOrder(response.order);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load order.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const voidOrder = async () => {
    if (!order) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await api.post<{ order: Order }>(`/api/orders/${order.id}/void`);
      setOrder(response.order);
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "Failed to void order.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="panel">Loading receipt...</div>;
  }

  if (error) {
    return <div className="panel error-box">{error}</div>;
  }

  if (!order) {
    return <div className="panel">Order not found.</div>;
  }

  return (
    <section className="panel receipt-panel">
      <div className="receipt-header-row">
        <h2>Receipt #{order.id}</h2>
        <span className={order.status === "VOIDED" ? "status-pill status-void" : "status-pill"}>
          {order.status}
        </span>
      </div>

      <p>
        <strong>Timestamp:</strong> {new Date(order.createdAt).toLocaleString()}
      </p>
      <p>
        <strong>Cashier:</strong> {order.cashier.username}
      </p>
      <p>
        <strong>Payment:</strong> {order.paymentType}
      </p>
      <p>
        <strong>Customer:</strong> {order.customer ? order.customer.name : "Walk-in"}
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td>{item.product.name}</td>
              <td>{item.quantity}</td>
              <td>{formatCents(item.unitPriceCents)}</td>
              <td>{formatCents(item.lineTotalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="totals-box receipt-totals">
        <div>
          <span>Subtotal</span>
          <strong>{formatCents(order.subtotalCents)}</strong>
        </div>
        <div>
          <span>Tax</span>
          <strong>{formatCents(order.taxCents)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{formatCents(order.totalCents)}</strong>
        </div>
      </div>

      <div className="button-row">
        <Link to="/pos">
          <button type="button">Back to POS</button>
        </Link>

        {order.status === "COMPLETED" ? (
          <button type="button" onClick={voidOrder} disabled={busy}>
            {busy ? "Voiding..." : "Void Order"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

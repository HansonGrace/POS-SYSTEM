import { useEffect, useState } from "react";
import { api, formatCents } from "../api";
import type { Metrics } from "../types";

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadMetrics = async () => {
      setLoading(true);
      setError("");

      try {
        const response = await api.get<{ metrics: Metrics }>("/api/admin/metrics");
        setMetrics(response.metrics);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load metrics.");
      } finally {
        setLoading(false);
      }
    };

    loadMetrics();
  }, []);

  if (loading) {
    return <div className="panel">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="panel error-box">{error}</div>;
  }

  if (!metrics) {
    return <div className="panel">No dashboard data available.</div>;
  }

  return (
    <div className="admin-page-grid">
      <section className="panel metric-grid">
        <article className="metric-card">
          <h3>Total Sales (Today)</h3>
          <strong>{formatCents(metrics.totalSalesTodayCents)}</strong>
        </article>
        <article className="metric-card">
          <h3>Total Sales (7 days)</h3>
          <strong>{formatCents(metrics.totalSales7DaysCents)}</strong>
        </article>
        <article className="metric-card">
          <h3>Orders Today</h3>
          <strong>{metrics.ordersToday}</strong>
        </article>
        <article className="metric-card">
          <h3>Orders (7 days)</h3>
          <strong>{metrics.orders7Days}</strong>
        </article>
        <article className="metric-card">
          <h3>Failed Logins (24h)</h3>
          <strong>{metrics.security.failedLogins24h}</strong>
        </article>
        <article className="metric-card">
          <h3>Lockouts (24h)</h3>
          <strong>{metrics.security.lockouts24h}</strong>
        </article>
        <article className="metric-card">
          <h3>Active Users</h3>
          <strong>
            {metrics.totals.activeUsers} / {metrics.totals.users}
          </strong>
        </article>
        <article className="metric-card">
          <h3>Active Products</h3>
          <strong>
            {metrics.totals.activeProducts} / {metrics.totals.products}
          </strong>
        </article>
      </section>

      <section className="panel">
        <h2>Top Selling Items (7 days)</h2>

        {metrics.topSellingItems.length === 0 ? (
          <div className="empty-state">No completed orders in the last 7 days.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Qty Sold</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {metrics.topSellingItems.map((row) => (
                <tr key={row.productId}>
                  <td>{row.productName}</td>
                  <td>{row.sku}</td>
                  <td>{row.quantitySold}</td>
                  <td>{formatCents(row.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

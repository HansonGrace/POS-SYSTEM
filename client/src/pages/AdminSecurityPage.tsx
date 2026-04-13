import { useEffect, useState, useCallback } from "react";
import { api, formatCents } from "../api";

type ThreatLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Alert = {
  id: string;
  severity: string;
  title: string;
  description: string;
  metric: number;
  threshold: number;
};

type AttackerIP = {
  ip: string;
  failedAttempts: number;
};

type CriticalEvent = {
  id: number;
  action: string;
  severity: string;
  category: string;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  actor: { id: number; username: string; role: string } | null;
};

type TimelineEntry = {
  hour: string;
  attempts: number;
  failures: number;
  successes: number;
};

type Dashboard = {
  threatLevel: ThreatLevel;
  timestamp: string;
  summary: {
    failedLogins1h: number;
    failedLogins24h: number;
    lockouts24h: number;
    suspiciousEvents24h: number;
    totalEvents24h: number;
    debugEndpointAccess24h: number;
    idorAttempts24h: number;
  };
  recentCriticalEvents: CriticalEvent[];
  topAttackerIPs: AttackerIP[];
  eventsByCategory: { category: string; count: number }[];
  eventsBySeverity: { severity: string; count: number }[];
  loginTimeline: TimelineEntry[];
};

type LiveEvent = {
  id: number;
  action: string;
  severity: string;
  category: string;
  ip: string | null;
  createdAt: string;
  actor: { id: number; username: string; role: string } | null;
  metadata: Record<string, unknown> | null;
};

const THREAT_COLORS: Record<ThreatLevel, string> = {
  LOW: "#22c55e",
  MEDIUM: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#ef4444"
};

const SEVERITY_COLORS: Record<string, string> = {
  info: "#3b82f6",
  warning: "#eab308",
  critical: "#ef4444"
};

export default function AdminSecurityPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lockUserId, setLockUserId] = useState("");
  const [lockReason, setLockReason] = useState("");
  const [lockMessage, setLockMessage] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [dashResult, alertResult, liveResult] = await Promise.all([
        api.get<{ dashboard: Dashboard }>("/api/security/dashboard"),
        api.get<{ alerts: Alert[] }>("/api/security/alerts"),
        api.get<{ events: LiveEvent[] }>("/api/security/events/live?since=" + new Date(Date.now() - 10 * 60 * 1000).toISOString())
      ]);
      setDashboard(dashResult.dashboard);
      setAlerts(alertResult.alerts);
      setLiveEvents(liveResult.events);
      setLastRefresh(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load security dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadDashboard, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadDashboard]);

  const handleLockUser = async () => {
    const userId = parseInt(lockUserId, 10);
    if (!userId) return;
    try {
      const result = await api.post<{ message: string }>("/api/security/respond/lock-user", {
        userId,
        reason: lockReason || "Locked by security team",
        durationMinutes: 60
      });
      setLockMessage(result.message + ` (User ID: ${userId})`);
      setLockUserId("");
      setLockReason("");
      loadDashboard();
    } catch (err) {
      setLockMessage(err instanceof Error ? err.message : "Failed to lock user.");
    }
  };

  const handleUnlockUser = async () => {
    const userId = parseInt(lockUserId, 10);
    if (!userId) return;
    try {
      const result = await api.post<{ message: string }>("/api/security/respond/unlock-user", {
        userId,
        reason: lockReason || "Unlocked by security team"
      });
      setLockMessage(result.message + ` (User ID: ${userId})`);
      setLockUserId("");
      setLockReason("");
      loadDashboard();
    } catch (err) {
      setLockMessage(err instanceof Error ? err.message : "Failed to unlock user.");
    }
  };

  if (loading) {
    return <div className="empty-state">Loading security dashboard...</div>;
  }

  if (error) {
    return <div className="error-box">{error}</div>;
  }

  if (!dashboard) {
    return <div className="empty-state">No data available.</div>;
  }

  return (
    <section className="panel security-dashboard">
      {/* Header */}
      <div className="panel-header-row">
        <h2>Security Operations Center</h2>
        <div className="button-row">
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>
            {lastRefresh ? `Updated: ${lastRefresh.toLocaleTimeString()}` : ""}
          </span>
          <button type="button" onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? "Pause" : "Resume"} Auto-Refresh
          </button>
          <button type="button" onClick={loadDashboard}>Refresh Now</button>
        </div>
      </div>

      {/* Threat Level Banner */}
      <div
        className="threat-banner"
        style={{
          backgroundColor: THREAT_COLORS[dashboard.threatLevel],
          color: dashboard.threatLevel === "LOW" ? "#000" : "#fff",
          padding: "1rem",
          borderRadius: "8px",
          marginBottom: "1.5rem",
          textAlign: "center",
          fontSize: "1.2rem",
          fontWeight: "bold"
        }}
      >
        THREAT LEVEL: {dashboard.threatLevel}
      </div>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div className="security-section" style={{ marginBottom: "1.5rem" }}>
          <h3>Active Alerts ({alerts.length})</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {alerts.map((alert) => (
              <div
                key={alert.id}
                style={{
                  padding: "0.75rem 1rem",
                  borderLeft: `4px solid ${SEVERITY_COLORS[alert.severity] || "#666"}`,
                  backgroundColor: "var(--surface, #1e1e1e)",
                  borderRadius: "4px"
                }}
              >
                <div style={{ fontWeight: "bold" }}>{alert.title}</div>
                <div style={{ fontSize: "0.85rem", opacity: 0.8 }}>{alert.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div
        className="security-stats-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
          marginBottom: "1.5rem"
        }}
      >
        <StatCard label="Failed Logins (1h)" value={dashboard.summary.failedLogins1h} warn={dashboard.summary.failedLogins1h > 5} />
        <StatCard label="Failed Logins (24h)" value={dashboard.summary.failedLogins24h} warn={dashboard.summary.failedLogins24h > 20} />
        <StatCard label="Account Lockouts" value={dashboard.summary.lockouts24h} warn={dashboard.summary.lockouts24h > 0} />
        <StatCard label="Suspicious Events" value={dashboard.summary.suspiciousEvents24h} warn={dashboard.summary.suspiciousEvents24h > 0} />
        <StatCard label="Debug Endpoint Hits" value={dashboard.summary.debugEndpointAccess24h} warn={dashboard.summary.debugEndpointAccess24h > 0} />
        <StatCard label="IDOR Attempts" value={dashboard.summary.idorAttempts24h} warn={dashboard.summary.idorAttempts24h > 5} />
        <StatCard label="Total Events (24h)" value={dashboard.summary.totalEvents24h} />
      </div>

      {/* Two column: Top IPs + Incident Response */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        {/* Top Attacker IPs */}
        <div className="security-section">
          <h3>Top Attacker IPs (24h)</h3>
          {dashboard.topAttackerIPs.length === 0 ? (
            <div className="empty-state">No failed login IPs detected.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>IP Address</th>
                  <th>Failed Attempts</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.topAttackerIPs.map((ip) => (
                  <tr key={ip.ip}>
                    <td style={{ fontFamily: "monospace" }}>{ip.ip}</td>
                    <td style={{ color: ip.failedAttempts > 10 ? "#ef4444" : "inherit" }}>
                      {ip.failedAttempts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Incident Response Panel */}
        <div className="security-section">
          <h3>Incident Response</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <input
              type="number"
              placeholder="User ID to lock/unlock"
              value={lockUserId}
              onChange={(e) => setLockUserId(e.target.value)}
              style={{ padding: "0.5rem" }}
            />
            <input
              type="text"
              placeholder="Reason"
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              style={{ padding: "0.5rem" }}
            />
            <div className="button-row">
              <button type="button" onClick={handleLockUser} style={{ backgroundColor: "#ef4444", color: "#fff" }}>
                Lock User
              </button>
              <button type="button" onClick={handleUnlockUser} style={{ backgroundColor: "#22c55e", color: "#fff" }}>
                Unlock User
              </button>
            </div>
            {lockMessage && (
              <div style={{ fontSize: "0.85rem", padding: "0.5rem", background: "var(--surface, #1e1e1e)", borderRadius: "4px" }}>
                {lockMessage}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Events by Category and Severity */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
        <div className="security-section">
          <h3>Events by Category</h3>
          <table className="data-table">
            <thead>
              <tr><th>Category</th><th>Count</th></tr>
            </thead>
            <tbody>
              {dashboard.eventsByCategory.map((row) => (
                <tr key={row.category}>
                  <td>{row.category || "uncategorized"}</td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="security-section">
          <h3>Events by Severity</h3>
          <table className="data-table">
            <thead>
              <tr><th>Severity</th><th>Count</th></tr>
            </thead>
            <tbody>
              {dashboard.eventsBySeverity.map((row) => (
                <tr key={row.severity}>
                  <td>
                    <span style={{ color: SEVERITY_COLORS[row.severity] || "#888" }}>
                      {row.severity || "unknown"}
                    </span>
                  </td>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Login Timeline */}
      {dashboard.loginTimeline.length > 0 && (
        <div className="security-section" style={{ marginBottom: "1.5rem" }}>
          <h3>Login Activity Timeline (24h)</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Hour</th>
                <th>Total Attempts</th>
                <th>Failures</th>
                <th>Successes</th>
                <th>Failure Rate</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.loginTimeline.map((entry) => {
                const rate = entry.attempts > 0 ? ((entry.failures / entry.attempts) * 100).toFixed(0) : "0";
                return (
                  <tr key={entry.hour}>
                    <td>{new Date(entry.hour).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{entry.attempts}</td>
                    <td style={{ color: entry.failures > 5 ? "#ef4444" : "inherit" }}>{entry.failures}</td>
                    <td style={{ color: "#22c55e" }}>{entry.successes}</td>
                    <td style={{ color: parseInt(rate) > 50 ? "#ef4444" : "inherit" }}>{rate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent Critical Events */}
      <div className="security-section" style={{ marginBottom: "1.5rem" }}>
        <h3>Recent Critical/Warning Events</h3>
        {dashboard.recentCriticalEvents.length === 0 ? (
          <div className="empty-state">No critical events in the last 24 hours.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Action</th>
                <th>User</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.recentCriticalEvents.map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString()}</td>
                  <td style={{ color: SEVERITY_COLORS[event.severity] || "#888" }}>{event.severity}</td>
                  <td>{event.action}</td>
                  <td>{event.actor?.username || "system"}</td>
                  <td style={{ fontFamily: "monospace" }}>{event.ip || "n/a"}</td>
                  <td style={{ fontSize: "0.8rem", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {event.metadata ? JSON.stringify(event.metadata) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Live Event Feed */}
      <div className="security-section">
        <h3>Live Event Feed (last 10 min)</h3>
        {liveEvents.length === 0 ? (
          <div className="empty-state">No events in the last 10 minutes.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Severity</th>
                <th>Category</th>
                <th>Action</th>
                <th>User</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {liveEvents.slice(0, 50).map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleTimeString()}</td>
                  <td style={{ color: SEVERITY_COLORS[event.severity] || "#888" }}>{event.severity}</td>
                  <td>{event.category}</td>
                  <td>{event.action}</td>
                  <td>{event.actor?.username || "system"}</td>
                  <td style={{ fontFamily: "monospace" }}>{event.ip || "n/a"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div
      style={{
        padding: "1rem",
        backgroundColor: "var(--surface, #1e1e1e)",
        borderRadius: "8px",
        borderLeft: warn ? "4px solid #ef4444" : "4px solid var(--border, #333)",
        textAlign: "center"
      }}
    >
      <div style={{ fontSize: "2rem", fontWeight: "bold", color: warn ? "#ef4444" : "inherit" }}>
        {value}
      </div>
      <div style={{ fontSize: "0.85rem", opacity: 0.7 }}>{label}</div>
    </div>
  );
}

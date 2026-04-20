import { useEffect, useState, useCallback } from "react";
import { api } from "../api";

// SOC dashboard. Pulls /api/security/dashboard + /alerts + /events/live on an interval.
// This is a lab tool - don't expect fancy graphs, just the raw numbers a human operator needs.

type ThreatLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface Alert {
  id: string;
  severity: string;
  title: string;
  description: string;
  metric: number;
  threshold: number;
}

interface AttackerIP {
  ip: string;
  failedAttempts: number;
}

interface CriticalEvent {
  id: number;
  action: string;
  severity: string;
  category: string;
  ip: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  actor: { id: number; username: string; role: string } | null;
}

interface TimelineEntry {
  hour: string;
  attempts: number;
  failures: number;
  successes: number;
}

interface Dashboard {
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
}

interface LiveEvent {
  id: number;
  action: string;
  severity: string;
  category: string;
  ip: string | null;
  createdAt: string;
  actor: { id: number; username: string; role: string } | null;
  metadata: Record<string, unknown> | null;
}

const REFRESH_MS = 10_000;

function sevClass(sev: string): string {
  if (sev === "critical") return "soc-sev-critical";
  if (sev === "warning") return "soc-sev-warning";
  return "soc-sev-info";
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AdminSecurityPage() {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [live, setLive] = useState<LiveEvent[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // incident response state
  const [targetUserId, setTargetUserId] = useState("");
  const [irReason, setIrReason] = useState("");
  const [irResult, setIrResult] = useState("");

  const load = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const [d, a, l] = await Promise.all([
        api.get<{ dashboard: Dashboard }>("/api/security/dashboard"),
        api.get<{ alerts: Alert[] }>("/api/security/alerts"),
        api.get<{ events: LiveEvent[] }>(`/api/security/events/live?since=${since}`)
      ]);
      setDash(d.dashboard);
      setAlerts(a.alerts);
      setLive(l.events);
      setLastRefresh(new Date());
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load SOC data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  async function runLock(action: "lock-user" | "unlock-user") {
    const uid = parseInt(targetUserId, 10);
    if (!uid) {
      setIrResult("User ID required.");
      return;
    }
    try {
      const body: Record<string, unknown> = { userId: uid, reason: irReason || "via SOC" };
      if (action === "lock-user") body.durationMinutes = 60;
      const r = await api.post<{ message: string }>(`/api/security/respond/${action}`, body);
      setIrResult(`${r.message} (uid ${uid})`);
      setTargetUserId("");
      setIrReason("");
      load();
    } catch (e) {
      setIrResult(e instanceof Error ? e.message : "Action failed.");
    }
  }

  if (loading) return <div className="empty-state">Loading SOC data...</div>;
  if (err) return <div className="error-box">{err}</div>;
  if (!dash) return <div className="empty-state">No data.</div>;

  const s = dash.summary;

  return (
    <section className="panel">
      <div className="soc-toolbar">
        <h2>Security Operations</h2>
        <div className="button-row">
          <span className="meta">
            {lastRefresh ? `updated ${lastRefresh.toLocaleTimeString()}` : ""}
          </span>
          <button type="button" onClick={() => setAutoRefresh((v) => !v)}>
            {autoRefresh ? "Pause" : "Resume"}
          </button>
          <button type="button" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className={`soc-threat ${dash.threatLevel.toLowerCase()}`}>
        <span className="label">Threat level</span>
        <span className="value">{dash.threatLevel}</span>
      </div>

      {alerts.length > 0 && (
        <div className="soc-alerts">
          {alerts.map((a) => (
            <div key={a.id} className="soc-alert">
              <div className="title">
                <span className={`sev ${a.severity}`}>{a.severity}</span>
                {a.title}
              </div>
              <div className="desc">{a.description}</div>
            </div>
          ))}
        </div>
      )}

      <div className="soc-stats">
        <Stat label="Failed logins (1h)" value={s.failedLogins1h} warn={s.failedLogins1h > 5} />
        <Stat label="Failed logins (24h)" value={s.failedLogins24h} warn={s.failedLogins24h > 20} />
        <Stat label="Lockouts (24h)" value={s.lockouts24h} warn={s.lockouts24h > 0} />
        <Stat label="Suspicious events" value={s.suspiciousEvents24h} warn={s.suspiciousEvents24h > 0} />
        <Stat label="Debug endpoint hits" value={s.debugEndpointAccess24h} warn={s.debugEndpointAccess24h > 0} />
        <Stat label="IDOR attempts" value={s.idorAttempts24h} warn={s.idorAttempts24h > 5} />
        <Stat label="Events (24h)" value={s.totalEvents24h} />
      </div>

      <div className="soc-grid-2">
        <div className="soc-section">
          <h3>Top attacker IPs (24h)</h3>
          {dash.topAttackerIPs.length === 0 ? (
            <div className="empty">No failed-login IPs recorded.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>IP</th><th>Failures</th></tr>
              </thead>
              <tbody>
                {dash.topAttackerIPs.map((r) => (
                  <tr key={r.ip} className={r.failedAttempts > 10 ? "soc-row-hot" : ""}>
                    <td className="soc-mono">{r.ip}</td>
                    <td>{r.failedAttempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="soc-section">
          <h3>Incident response</h3>
          <div className="soc-ir">
            <input
              type="number"
              placeholder="User ID"
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
            />
            <input
              type="text"
              placeholder="Reason (optional)"
              value={irReason}
              onChange={(e) => setIrReason(e.target.value)}
            />
            <div className="button-row">
              <button type="button" onClick={() => runLock("lock-user")}>Lock user (60m)</button>
              <button type="button" onClick={() => runLock("unlock-user")}>Unlock user</button>
            </div>
            {irResult && <div className="result">{irResult}</div>}
          </div>
        </div>
      </div>

      <div className="soc-grid-2">
        <div className="soc-section">
          <h3>Events by category</h3>
          <table className="data-table">
            <thead><tr><th>Category</th><th>Count</th></tr></thead>
            <tbody>
              {dash.eventsByCategory.map((r) => (
                <tr key={r.category}>
                  <td>{r.category || "uncategorized"}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="soc-section">
          <h3>Events by severity</h3>
          <table className="data-table">
            <thead><tr><th>Severity</th><th>Count</th></tr></thead>
            <tbody>
              {dash.eventsBySeverity.map((r) => (
                <tr key={r.severity}>
                  <td className={sevClass(r.severity)}>{r.severity || "unknown"}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {dash.loginTimeline.length > 0 && (
        <div className="soc-section" style={{ marginBottom: 14 }}>
          <h3>Login activity (hourly, 24h)</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Hour</th><th>Attempts</th><th>Failures</th><th>Success</th><th>Fail %</th>
              </tr>
            </thead>
            <tbody>
              {dash.loginTimeline.map((t) => {
                const rate = t.attempts > 0 ? Math.round((t.failures / t.attempts) * 100) : 0;
                return (
                  <tr key={t.hour} className={rate > 50 ? "soc-row-hot" : ""}>
                    <td className="soc-mono">{fmtTime(t.hour)}</td>
                    <td>{t.attempts}</td>
                    <td>{t.failures}</td>
                    <td>{t.successes}</td>
                    <td>{rate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="soc-section" style={{ marginBottom: 14 }}>
        <h3>Recent critical / warning events</h3>
        {dash.recentCriticalEvents.length === 0 ? (
          <div className="empty">Nothing critical in the last 24h.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th><th>Sev</th><th>Action</th><th>User</th><th>IP</th><th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {dash.recentCriticalEvents.map((ev) => (
                <tr key={ev.id}>
                  <td className="soc-mono">{new Date(ev.createdAt).toLocaleString()}</td>
                  <td className={sevClass(ev.severity)}>{ev.severity}</td>
                  <td>{ev.action}</td>
                  <td>{ev.actor?.username ?? "—"}</td>
                  <td className="soc-mono">{ev.ip ?? "—"}</td>
                  <td style={{ fontSize: "0.8rem", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.metadata ? JSON.stringify(ev.metadata) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="soc-section">
        <h3>Live feed (last 10 min)</h3>
        {live.length === 0 ? (
          <div className="empty">No events.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th><th>Sev</th><th>Category</th><th>Action</th><th>User</th><th>IP</th>
              </tr>
            </thead>
            <tbody>
              {live.slice(0, 50).map((ev) => (
                <tr key={ev.id}>
                  <td className="soc-mono">{new Date(ev.createdAt).toLocaleTimeString()}</td>
                  <td className={sevClass(ev.severity)}>{ev.severity}</td>
                  <td>{ev.category}</td>
                  <td>{ev.action}</td>
                  <td>{ev.actor?.username ?? "—"}</td>
                  <td className="soc-mono">{ev.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn ? "soc-stat warn" : "soc-stat"}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

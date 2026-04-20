import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Range control panel for the TORCHADMIN (range operator) role.
// Lets the operator toggle training features on/off between exercise rounds
// and see a quick range overview.

interface SettingMap {
  soc_dashboard_enabled: string;
  audit_log_visible: string;
  debug_endpoints_enabled: string;
  red_team_simulator_visible: string;
  [k: string]: string;
}

interface Overview {
  userCount: number;
  cashierCount: number;
  adminCount: number;
  lockedAccounts: number;
  recentFailedLogins1h: number;
  generatedAt: string;
}

const TOGGLE_META: { key: string; label: string; help: string }[] = [
  {
    key: "soc_dashboard_enabled",
    label: "SOC dashboard",
    help: "When OFF, regular admins lose access to /admin/security. Forces blue team to defend via audit logs, pfSense, and pos-siem-01."
  },
  {
    key: "audit_log_visible",
    label: "Audit log page",
    help: "Hides /admin/audit-logs from regular admins. Blue team has to read server logs via SSH."
  },
  {
    key: "debug_endpoints_enabled",
    label: "Debug endpoints",
    help: "Controls whether /api/debug/* responds. Turn OFF to remove one attack vector between rounds."
  },
  {
    key: "red_team_simulator_visible",
    label: "Red team simulator note",
    help: "Cosmetic flag used by docs/overview pages to hint that simulate-attacks.js is scripted to run."
  }
];

export default function RangeControlPage() {
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState<SettingMap | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");

  async function load() {
    try {
      const [s, o] = await Promise.all([
        api.get<{ settings: SettingMap }>("/api/range/settings"),
        api.get<{ overview: Overview }>("/api/range/overview")
      ]);
      setSettings(s.settings);
      setOverview(o.overview);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load range control.");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  async function toggle(key: string) {
    if (!settings) return;
    const next = settings[key] === "true" ? "false" : "true";
    setSaving(true);
    try {
      const r = await api.put<{ settings: SettingMap }>("/api/range/settings", { [key]: next });
      setSettings(r.settings);
      setSaved(`Updated ${key} -> ${next}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(""), 2500);
    }
  }

  if (err && !settings) return <div className="error-box">{err}</div>;
  if (!settings || !overview) return <div className="empty-state">Loading range control...</div>;

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-title">Range Control — TORCHADMIN</div>
        <div className="button-row">
          <span className="meta" style={{ fontSize: "0.85rem", opacity: 0.7 }}>
            {user?.username}
          </span>
          <button type="button" onClick={() => logout()}>Logout</button>
        </div>
      </header>

      <main className="admin-main" style={{ padding: 16 }}>
        <section className="panel" style={{ marginBottom: 14 }}>
          <h2>Range overview</h2>
          <div className="soc-stats">
            <Stat label="Total users" value={overview.userCount} />
            <Stat label="Admins" value={overview.adminCount} />
            <Stat label="Cashiers" value={overview.cashierCount} />
            <Stat label="Locked accounts" value={overview.lockedAccounts} warn={overview.lockedAccounts > 0} />
            <Stat label="Failed logins (1h)" value={overview.recentFailedLogins1h} warn={overview.recentFailedLogins1h > 5} />
          </div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Snapshot as of {new Date(overview.generatedAt).toLocaleString()}. Auto-refreshes every 15s.
          </p>
        </section>

        <section className="panel">
          <div className="soc-toolbar">
            <h2>Feature toggles</h2>
            <span className="meta">{saving ? "saving..." : saved}</span>
          </div>

          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)", marginBottom: 10 }}>
            Toggle blue-team/red-team features on or off between training rounds. Changes apply
            immediately — no server restart required. Regular ADMIN accounts see these changes
            reflected in their sidebar and endpoint access.
          </p>

          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "20%" }}>Feature</th>
                <th style={{ width: "10%" }}>State</th>
                <th style={{ width: "50%" }}>Description</th>
                <th style={{ width: "20%" }}></th>
              </tr>
            </thead>
            <tbody>
              {TOGGLE_META.map((m) => {
                const on = settings[m.key] === "true";
                return (
                  <tr key={m.key}>
                    <td><strong>{m.label}</strong></td>
                    <td className={on ? "soc-sev-info" : "soc-sev-warning"}>
                      {on ? "ON" : "OFF"}
                    </td>
                    <td style={{ fontSize: "0.85rem" }}>{m.help}</td>
                    <td>
                      <button type="button" disabled={saving} onClick={() => toggle(m.key)}>
                        Set {on ? "OFF" : "ON"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {err && (
          <div className="error-box" style={{ marginTop: 10 }}>{err}</div>
        )}
      </main>
    </div>
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

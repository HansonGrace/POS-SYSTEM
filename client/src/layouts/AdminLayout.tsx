import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import TopNav from "../components/TopNav";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

interface PublicSettings {
  soc_dashboard_enabled?: string;
  audit_log_visible?: string;
}

const baseLinks = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/customers", label: "Customers" }
];

export default function AdminLayout() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<PublicSettings>({
    soc_dashboard_enabled: "true",
    audit_log_visible: "true"
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get<{ settings: PublicSettings }>("/api/range/settings/public");
        if (!cancelled) setSettings(r.settings);
      } catch {
        // Fall back to defaults on error - layout still renders
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const isSuperAdmin = user?.role === "SUPERADMIN";
  const socEnabled = isSuperAdmin || settings.soc_dashboard_enabled !== "false";
  const auditVisible = isSuperAdmin || settings.audit_log_visible !== "false";

  const links = [...baseLinks];
  if (auditVisible) links.push({ to: "/admin/audit-logs", label: "Audit Logs" });
  if (socEnabled) links.push({ to: "/admin/security", label: "Security SOC" });
  if (isSuperAdmin) links.push({ to: "/range", label: "Range Control" });

  return (
    <div className="app-shell">
      <TopNav title="Admin Panel" />
      <div className="admin-shell">
        <aside className="admin-sidebar">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/admin"}
              className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}
            >
              {link.label}
            </NavLink>
          ))}
        </aside>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

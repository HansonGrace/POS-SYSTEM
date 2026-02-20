import { NavLink, Outlet } from "react-router-dom";
import TopNav from "../components/TopNav";

const links = [
  { to: "/admin", label: "Dashboard" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/orders", label: "Orders" },
  { to: "/admin/customers", label: "Customers" },
  { to: "/admin/audit-logs", label: "Audit Logs" }
];

export default function AdminLayout() {
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

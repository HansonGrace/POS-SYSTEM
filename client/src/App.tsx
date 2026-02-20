import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";
import AdminLayout from "./layouts/AdminLayout";
import CashierLayout from "./layouts/CashierLayout";
import AdminCustomersPage from "./pages/AdminCustomersPage";
import AdminDashboardPage from "./pages/AdminDashboardPage";
import AdminAuditLogsPage from "./pages/AdminAuditLogsPage";
import AdminOrdersPage from "./pages/AdminOrdersPage";
import AdminProductsPage from "./pages/AdminProductsPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import CashierPosPage from "./pages/CashierPosPage";
import LoginPage from "./pages/LoginPage";
import ReceiptPage from "./pages/ReceiptPage";

function HomeRedirect() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading session...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={user.role === "ADMIN" ? "/admin" : "/pos"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute allowedRoles={["CASHIER"]} />}>
        <Route element={<CashierLayout />}>
          <Route path="/pos" element={<CashierPosPage />} />
          <Route path="/pos/receipt/:id" element={<ReceiptPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute allowedRoles={["ADMIN"]} />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/products" element={<AdminProductsPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/orders" element={<AdminOrdersPage />} />
          <Route path="/admin/customers" element={<AdminCustomersPage />} />
          <Route path="/admin/audit-logs" element={<AdminAuditLogsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

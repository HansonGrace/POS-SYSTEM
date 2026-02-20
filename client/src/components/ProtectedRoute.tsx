import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../types";

export default function ProtectedRoute({ allowedRoles }: { allowedRoles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="page-loading">Loading session...</div>;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    const target = user.role === "ADMIN" ? "/admin" : "/pos";
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}

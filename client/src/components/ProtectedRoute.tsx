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

  // SUPERADMIN has access to everything a regular admin can reach.
  const effectiveRoles: Role[] = user.role === "SUPERADMIN" ? ["SUPERADMIN", "ADMIN"] : [user.role];
  const allowed = effectiveRoles.some((r) => allowedRoles.includes(r));

  if (!allowed) {
    const target = user.role === "ADMIN" || user.role === "SUPERADMIN" ? "/admin" : "/pos";
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}

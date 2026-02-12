import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getSession } from "../lib/auth";

type ProtectedRouteProps = {
  requiredRole: "user" | "admin";
  redirectTo: string;
  children: ReactNode;
};

function ProtectedRoute({ requiredRole, redirectTo, children }: ProtectedRouteProps) {
  const session = getSession();

  if (!session || session.role !== requiredRole) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;

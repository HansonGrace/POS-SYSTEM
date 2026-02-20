import { hasPermission } from "../auth/permissions.js";

function getSessionUser(req) {
  const user = req.session?.authUser;
  if (user) {
    req.user = user;
  }
  return user;
}

export function requireAuth(req, res, next) {
  if (!getSessionUser(req)) {
    return res.status(401).json({ message: "Authentication required." });
  }
  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    if (!roles.includes(user.role)) {
      return res.status(403).json({ message: "Insufficient permissions." });
    }

    return next();
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    if (!hasPermission(user.role, permission)) {
      return res.status(403).json({ message: "Insufficient permissions." });
    }

    return next();
  };
}

export function requireAnyPermission(...permissionList) {
  return (req, res, next) => {
    const user = getSessionUser(req);
    if (!user) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const allowed = permissionList.some((permission) => hasPermission(user.role, permission));
    if (!allowed) {
      return res.status(403).json({ message: "Insufficient permissions." });
    }

    return next();
  };
}

import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spin } from "@douyinfe/semi-ui";
import { useAuth } from "../../hooks";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spin size="large" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { user } = useAuth();

  return user.isAdmin ? <Outlet /> : <Navigate to="/projects" replace />;
}

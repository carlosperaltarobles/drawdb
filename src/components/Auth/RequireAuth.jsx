import {
  Navigate,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { Spin } from "@douyinfe/semi-ui";
import { useAuth } from "../../hooks";
import { safeNextPath } from "../../utils/authMessages";

function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Spin size="large" />
    </div>
  );
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { user } = useAuth();

  return user?.isAdmin ? <Outlet /> : <Navigate to="/projects" replace />;
}

export function GuestOnly() {
  const { user, loading } = useAuth();
  const [params] = useSearchParams();

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={safeNextPath(params.get("next"))} replace />;
  return <Outlet />;
}

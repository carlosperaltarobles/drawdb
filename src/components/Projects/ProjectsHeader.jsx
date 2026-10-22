import { Link, useNavigate } from "react-router-dom";
import { Button } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import ErrorBanner from "../Auth/ErrorBanner";
import useSubmit from "../Auth/useSubmit";
import { useAuth } from "../../hooks";

export default function ProjectsHeader() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = useSubmit(async () => {
    await logout();
    navigate("/login", { replace: true });
  });

  return (
    <header className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/projects" className="font-semibold">
          {t("projects")}
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <span className="opacity-70">{user.name}</span>
          <Link to="/account">{t("account")}</Link>
          {user.isAdmin && <Link to="/admin/users">{t("users")}</Link>}
          <Button
            type="tertiary"
            size="small"
            loading={signOut.loading}
            onClick={signOut.submit}
          >
            {t("logout")}
          </Button>
        </nav>
      </div>
      <ErrorBanner message={signOut.error} />
    </header>
  );
}

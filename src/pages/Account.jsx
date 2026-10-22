import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import { MIN_PASSWORD_LENGTH } from "../data/constants";
import useSubmit from "../components/Auth/useSubmit";
import { changePassword } from "../api/auth";
import { useAuth } from "../hooks";

export default function Account() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const { submit, loading, error } = useSubmit(async () => {
    await changePassword(currentPassword, newPassword);
    setCurrentPassword("");
    setNewPassword("");
    Toast.success(t("password_updated"));
  });

  const signOut = useSubmit(async () => {
    await logout();
    navigate("/login", { replace: true });
  });

  return (
    <AuthLayout title={t("account")}>
      <div className="text-sm opacity-70">
        {user.name} · {user.email}
      </div>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Input
          mode="password"
          autoComplete="current-password"
          placeholder={t("current_password")}
          value={currentPassword}
          onChange={setCurrentPassword}
        />
        <Input
          mode="password"
          autoComplete="new-password"
          placeholder={t("new_password_min_length", {
            count: MIN_PASSWORD_LENGTH,
          })}
          value={newPassword}
          onChange={setNewPassword}
        />
        <Button
          htmlType="submit"
          theme="solid"
          block
          loading={loading}
          disabled={
            !currentPassword || newPassword.length < MIN_PASSWORD_LENGTH
          }
        >
          {t("change_password")}
        </Button>
      </form>
      <ErrorBanner message={signOut.error} />
      <div className="text-sm flex justify-between">
        <Link to="/projects">{t("projects")}</Link>
        <Button
          type="tertiary"
          size="small"
          loading={signOut.loading}
          onClick={signOut.submit}
        >
          {t("logout")}
        </Button>
      </div>
    </AuthLayout>
  );
}

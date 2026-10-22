import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import useSubmit from "../components/Auth/useSubmit";
import { useAuth } from "../hooks";
import { safeNextPath } from "../utils/authMessages";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { submit, loading, error } = useSubmit(async () => {
    await login(email, password);
    navigate(safeNextPath(params.get("next")), { replace: true });
  });

  return (
    <AuthLayout title={t("login")}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Input
          type="email"
          placeholder={t("email")}
          value={email}
          onChange={setEmail}
        />
        <Input
          mode="password"
          placeholder={t("password")}
          value={password}
          onChange={setPassword}
        />
        <Button
          htmlType="submit"
          theme="solid"
          block
          loading={loading}
          disabled={!email || !password}
        >
          {t("login")}
        </Button>
      </form>
      <div className="text-sm flex justify-between">
        <Link to="/forgot">{t("forgot_password")}</Link>
        <Link to="/register">{t("create_account")}</Link>
      </div>
    </AuthLayout>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Input } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import useSubmit from "../components/Auth/useSubmit";
import { useAuth } from "../hooks";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { submit, loading, error } = useSubmit(() => login(email, password));

  return (
    <AuthLayout title={t("login")}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Input
          type="email"
          autoComplete="email"
          placeholder={t("email")}
          value={email}
          onChange={setEmail}
        />
        <Input
          mode="password"
          autoComplete="current-password"
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

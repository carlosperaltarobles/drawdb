import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import { MIN_PASSWORD_LENGTH } from "../data/constants";
import useSubmit from "../components/Auth/useSubmit";
import { reset } from "../api/auth";

export default function Reset() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");

  const { submit, loading, error } = useSubmit(async () => {
    await reset(params.get("token"), password);
    Toast.success(t("password_updated"));
    navigate("/login", { replace: true });
  });

  return (
    <AuthLayout title={t("reset_password")}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Input
          mode="password"
          autoComplete="new-password"
          placeholder={t("password_min_length", { count: MIN_PASSWORD_LENGTH })}
          value={password}
          onChange={setPassword}
        />
        <Button
          htmlType="submit"
          theme="solid"
          block
          loading={loading}
          disabled={password.length < MIN_PASSWORD_LENGTH}
        >
          {t("reset_password")}
        </Button>
      </form>
    </AuthLayout>
  );
}

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Banner, Button, Input, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import { MIN_PASSWORD_LENGTH } from "../data/constants";
import useSubmit from "../components/Auth/useSubmit";
import { register, resend } from "../api/auth";

export default function Register() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);

  const registration = useSubmit(async () => {
    await register({ email, name, password });
    setSent(true);
  });
  const resending = useSubmit(async () => {
    await resend(email);
    Toast.success(t("verification_email_resent"));
  });

  if (sent) {
    return (
      <AuthLayout title={t("create_account")}>
        <Banner type="success" description={t("verification_email_sent")} />
        <ErrorBanner message={resending.error} />
        <Button block loading={resending.loading} onClick={resending.submit}>
          {t("resend")}
        </Button>
      </AuthLayout>
    );
  }

  const canSubmit = name && email && password.length >= MIN_PASSWORD_LENGTH;

  return (
    <AuthLayout title={t("create_account")}>
      <form onSubmit={registration.submit} className="space-y-3">
        <ErrorBanner message={registration.error} />
        <Input placeholder={t("name")} value={name} onChange={setName} />
        <Input
          type="email"
          autoComplete="email"
          placeholder={t("email")}
          value={email}
          onChange={setEmail}
        />
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
          loading={registration.loading}
          disabled={!canSubmit}
        >
          {t("create_account")}
        </Button>
      </form>
      <div className="text-sm">
        <Link to="/login">{t("have_account")}</Link>
      </div>
    </AuthLayout>
  );
}

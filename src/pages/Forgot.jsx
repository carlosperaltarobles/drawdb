import { useState } from "react";
import { Link } from "react-router-dom";
import { Banner, Button, Input } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import useSubmit from "../components/Auth/useSubmit";
import { forgot } from "../api/auth";

export default function Forgot() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const { submit, loading, error } = useSubmit(async () => {
    await forgot(email);
    setSent(true);
  });

  return (
    <AuthLayout title={t("forgot_password")}>
      {sent ? (
        <Banner type="success" description={t("reset_email_sent")} />
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <ErrorBanner message={error} />
          <Input
            type="email"
            autoComplete="email"
            placeholder={t("email")}
            value={email}
            onChange={setEmail}
          />
          <Button
            htmlType="submit"
            theme="solid"
            block
            loading={loading}
            disabled={!email}
          >
            {t("send_reset_link")}
          </Button>
        </form>
      )}
      <div className="text-sm">
        <Link to="/login">{t("back_to_login")}</Link>
      </div>
    </AuthLayout>
  );
}

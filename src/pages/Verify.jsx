import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import useSubmit from "../components/Auth/useSubmit";
import { verify } from "../api/auth";
import { errorCode } from "../api/http";
import { useAuth } from "../hooks";

export default function Verify() {
  const { t } = useTranslation();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [invalidToken, setInvalidToken] = useState(false);

  const { submit, loading, error } = useSubmit(async () => {
    setInvalidToken(false);
    try {
      const res = await verify(token, password);
      setUser(res.user);
      navigate("/projects", { replace: true });
    } catch (err) {
      if (errorCode(err) !== "invalid_token") throw err;
      setInvalidToken(true);
    }
  });

  const message = invalidToken || !token ? t("verify_invalid_token") : error;

  return (
    <AuthLayout title={t("verify_confirm_title")}>
      <div className="space-y-3">
        <ErrorBanner message={message} />
        {token && (
          <form onSubmit={submit} className="space-y-3">
            <p>{t("verify_confirm_text")}</p>
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
              disabled={!password}
            >
              {t("activate_account")}
            </Button>
          </form>
        )}
        <Link to="/register">{t("resend_verification")}</Link>
      </div>
    </AuthLayout>
  );
}

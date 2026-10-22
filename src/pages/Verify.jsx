import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Spin } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AuthLayout from "../components/Auth/AuthLayout";
import ErrorBanner from "../components/Auth/ErrorBanner";
import { verify } from "../api/auth";
import { errorCode } from "../api/http";
import { useAuth } from "../hooks";
import { messageForError } from "../utils/authMessages";

export default function Verify() {
  const { t } = useTranslation();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    verify(params.get("token"))
      .then((res) => {
        setUser(res.user);
        navigate("/projects", { replace: true });
      })
      .catch((err) => setError(messageForError(errorCode(err), t)));
  }, [params, setUser, navigate, t]);

  return (
    <AuthLayout title={t("verify_account")}>
      {error ? (
        <>
          <ErrorBanner message={error} />
          <Link to="/login">{t("login")}</Link>
        </>
      ) : (
        <Spin />
      )}
    </AuthLayout>
  );
}

import { useEffect, useRef, useState } from "react";
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
  const token = params.get("token");
  const [failure, setFailure] = useState(null);
  const verifiedToken = useRef(null);

  useEffect(() => {
    if (verifiedToken.current === token) return;
    verifiedToken.current = token;

    verify(token)
      .then((res) => {
        setUser(res.user);
        navigate("/projects", { replace: true });
      })
      .catch((err) => setFailure({ code: errorCode(err) }));
  }, [token, setUser, navigate]);

  return (
    <AuthLayout title={t("verify_account")}>
      {failure ? (
        <>
          <ErrorBanner message={messageForError(failure.code, t)} />
          <Link to="/login">{t("login")}</Link>
        </>
      ) : (
        <Spin />
      )}
    </AuthLayout>
  );
}

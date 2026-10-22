import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorCode } from "../../api/http";
import { messageForError } from "../../utils/authMessages";

export default function useSubmit(action) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(messageForError(errorCode(err), t));
    } finally {
      setLoading(false);
    }
  };

  return { submit, loading, error };
}

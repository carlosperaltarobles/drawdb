import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AdminUsersTable from "../components/Projects/AdminUsersTable";
import AppShell from "../components/Projects/AppShell";
import ErrorBanner from "../components/Auth/ErrorBanner";
import { errorCode } from "../api/http";
import { setAdmin, users as fetchUsers } from "../api/admin";
import { messageForError } from "../utils/authMessages";

export default function AdminUsers() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setError(messageForError(errorCode(err), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleAdmin = async (user, isAdmin) => {
    setError("");
    setPendingId(user.id);
    try {
      await setAdmin(user.id, isAdmin);
    } catch (err) {
      setError(messageForError(errorCode(err), t));
    }
    // Reload either way so the switch reflects the server state.
    await refresh();
    setPendingId(null);
  };

  return (
    <AppShell>
      <h1 className="text-xl font-semibold mb-3">{t("users")}</h1>
      <ErrorBanner message={error} />
      <AdminUsersTable
        users={users}
        loading={loading}
        pendingId={pendingId}
        onToggleAdmin={toggleAdmin}
      />
    </AppShell>
  );
}

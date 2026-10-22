import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import AppShell from "../components/Projects/AppShell";
import ErrorBanner from "../components/Auth/ErrorBanner";
import MembersModal from "../components/Projects/MembersModal";
import ProjectNameModal from "../components/Projects/ProjectNameModal";
import ProjectsTable from "../components/Projects/ProjectsTable";
import { errorCode } from "../api/http";
import { create, list, remove, rename } from "../api/projects";
import { useAuth } from "../hooks";
import { messageForError } from "../utils/authMessages";
import { sortByUpdatedDesc } from "../utils/projects";

export default function Projects() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The open dialog: { type: "create" | "rename" | "members", project? }
  const [dialog, setDialog] = useState(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      setProjects(sortByUpdatedDesc(await list()));
    } catch (err) {
      setError(messageForError(errorCode(err), t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closeDialog = () => setDialog(null);

  const deleteProject = async (project) => {
    try {
      await remove(project.id);
      await refresh();
    } catch (err) {
      setError(messageForError(errorCode(err), t));
    }
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">{t("projects")}</h1>
        {user.isAdmin && (
          <Button theme="solid" onClick={() => setDialog({ type: "create" })}>
            {t("new_project")}
          </Button>
        )}
      </div>
      <ErrorBanner message={error} />
      <ProjectsTable
        projects={projects}
        loading={loading}
        onOpen={(project) => navigate(`/projects/${project.id}`)}
        onRename={(project) => setDialog({ type: "rename", project })}
        onMembers={(project) => setDialog({ type: "members", project })}
        onDelete={deleteProject}
      />
      {dialog?.type === "create" && (
        <ProjectNameModal
          title={t("new_project")}
          okText={t("create")}
          onSubmit={async (name) => {
            await create(name);
            await refresh();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === "rename" && (
        <ProjectNameModal
          title={t("rename")}
          okText={t("save")}
          initialName={dialog.project.name}
          onSubmit={async (name) => {
            await rename(dialog.project.id, name);
            await refresh();
          }}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === "members" && (
        <MembersModal
          projectId={dialog.project.id}
          visible
          onClose={closeDialog}
        />
      )}
    </AppShell>
  );
}

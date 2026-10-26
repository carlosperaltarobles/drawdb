import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { Toast } from "@douyinfe/semi-ui";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CollabContext } from "../context/CollabContext";
import * as history from "../api/history";
import { useAuth, useSettings } from "../hooks";
import { fitTransform } from "../utils/fitView";
import { formatHistoryTime } from "./PreviewBanner";
import { createPreviewLoader } from "./previewLoader";
import { DOC_KEYS, ProjectSession } from "./ProjectSession";
import * as viewStorage from "./viewStorage";

const DEFAULT_VIEW = { pan: { x: 0, y: 0 }, zoom: 1 };

export function normalizePreviewDoc(diagram = {}, currentDoc = {}) {
  const doc = {};
  for (const key of DOC_KEYS) {
    if (key === "database" || key === "sqlHeader") {
      doc[key] = diagram?.[key] ?? currentDoc?.[key];
    } else {
      doc[key] = Array.isArray(diagram?.[key]) ? diagram[key] : [];
    }
  }
  return doc;
}

// First visit to a project: show the whole diagram instead of the origin,
// which may be empty after an auto-arrange.
function initialView(doc, showComments) {
  const canvas = document.getElementById("canvas")?.getBoundingClientRect();
  return (
    fitTransform(
      { ...doc, relationships: doc.relationships ?? [] },
      canvas,
      showComments,
    ) ?? DEFAULT_VIEW
  );
}

export const ProjectCollabContext = createContext(null);
export const useProjectCollab = () => useContext(ProjectCollabContext);

export default function ProjectCollabProvider({ projectId, children }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const callbacks = useRef();
  callbacks.current = { navigate, t };
  const [state, setState] = useState({
    status: "connecting",
    role: null,
    projectName: "",
    peers: [],
    awareness: new Map(),
    ready: false,
    preview: null,
    version: 0,
    lastRestoredAt: 0,
  });
  const session = useMemo(
    () =>
      new ProjectSession({
        projectId,
        socket: io({ autoConnect: false, withCredentials: true }),
        onState: setState,
        onExit: (reason) => {
          Toast.error(
            callbacks.current.t(
              reason === "deleted"
                ? "project_deleted"
                : "project_access_revoked",
            ),
          );
          callbacks.current.navigate("/projects", { replace: true });
        },
        onNotice: (notice) => {
          if (notice?.type === "restored") {
            Toast.info(
              callbacks.current.t("history_restored_by", {
                name: notice.by?.name ?? "",
                time: formatHistoryTime(notice.snapshotCreatedAt),
              }),
            );
          }
        },
      }),
    [projectId],
  );
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  const actions = useMemo(() => {
    const docToEditor = (doc) => ({
      ...doc,
      references: doc.relationships,
      name: session.state.projectName,
      ...(viewStorage.load(projectId, user.id) ??
        initialView(doc, settings.showComments)),
      canWrite:
        ["admin", "editor"].includes(session.state.role) &&
        session.state.status === "online",
    });
    return {
      projectId,
      userId: user.id,
      docToEditor,
      waitForSnapshot: async () => docToEditor(await session.waitForSnapshot()),
      prepareCloudDiagram: () => docToEditor(session.hydrate()),
      registerAppliers: session.registerAppliers,
      observe: session.observe,
      sendAwareness: session.sendAwareness,
      canWrite: session.canWrite,
      flushPendingOps: session.flushPendingOps,
      flushPending: session.waitForAckedVersion,
      waitForAckedVersion: session.waitForAckedVersion,
      startPreview: session.startPreview,
      setAiPreviewMode: session.setAiPreviewMode,
      startAiPreview: ({
        proposal,
        before,
        after,
        mode = "after",
        stale,
        onApply,
        onDiscard,
        onRegenerate,
      }) => {
        const normalizedBefore = normalizePreviewDoc(before, session.editorDoc);
        const normalizedAfter = normalizePreviewDoc(after, session.editorDoc);
        const initialMode = mode === "before" ? "before" : "after";
        return session.startPreview(
          initialMode === "before" ? normalizedBefore : normalizedAfter,
          {
            kind: "ai",
            id: proposal.id,
            proposal,
            mode: initialMode,
            before: normalizedBefore,
            after: normalizedAfter,
            stale: Boolean(
              stale ||
                (proposal?.baseVersion != null &&
                  session.client.version !== proposal.baseVersion),
            ),
            onToggleMode: (nextMode) => session.setAiPreviewMode(nextMode),
            onApply,
            onDiscard,
            onRegenerate,
          },
        );
      },
      previewSnapshot: createPreviewLoader({
        fetch: (snapshotId) => history.get(projectId, snapshotId),
        start: ({ diagram, ...meta }) =>
          session.startPreview(
            normalizePreviewDoc(diagram, session.editorDoc),
            { kind: "history", ...meta },
          ),
        onError: () =>
          Toast.error(callbacks.current.t("history_preview_failed")),
      }),
      endPreview: session.endPreview,
    };
  }, [session, projectId, user.id, settings.showComments]);
  const collab = useMemo(
    () => ({
      emitDelta: () => {},
      emitAwareness: session.sendAwareness,
      isApplyingRemoteRef: { current: false },
    }),
    [session],
  );
  const value = useMemo(() => ({ ...state, ...actions }), [state, actions]);
  return (
    <ProjectCollabContext.Provider value={value}>
      <CollabContext.Provider value={collab}>{children}</CollabContext.Provider>
    </ProjectCollabContext.Provider>
  );
}

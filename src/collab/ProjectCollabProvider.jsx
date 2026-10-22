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
import { useAuth } from "../hooks";
import { ProjectSession } from "./ProjectSession";
import * as viewStorage from "./viewStorage";

export const ProjectCollabContext = createContext(null);
export const useProjectCollab = () => useContext(ProjectCollabContext);

export default function ProjectCollabProvider({ projectId, children }) {
  const { user } = useAuth();
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
      ...(viewStorage.load(projectId, user.id) ?? {
        pan: { x: 0, y: 0 },
        zoom: 1,
      }),
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
    };
  }, [session, projectId, user.id]);
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

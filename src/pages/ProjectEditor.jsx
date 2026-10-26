import LayoutContextProvider from "../context/LayoutContext";
import TransformContextProvider from "../context/TransformContext";
import TablesContextProvider from "../context/DiagramContext";
import UndoRedoContextProvider from "../context/UndoRedoContext";
import SelectContextProvider from "../context/SelectContext";
import AreasContextProvider from "../context/AreasContext";
import NotesContextProvider from "../context/NotesContext";
import TypesContextProvider from "../context/TypesContext";
import SettingsContextProvider from "../context/SettingsContext";
import SaveStateContextProvider from "../context/SaveStateContext";
import EnumsContextProvider from "../context/EnumsContext";
import ViewsContextProvider from "../context/ViewsContext";
import FocusContextProvider from "../context/FocusContext";
import WorkSpace from "../components/Workspace";
import { useThemedPage } from "../hooks";

import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ExtensionsContext from "../context/ExtensionsContext";
import ProjectCollabProvider, {
  useProjectCollab,
} from "../collab/ProjectCollabProvider";
import CollabBridge from "../collab/CollabBridge";
import HistoryPanel from "../collab/HistoryPanel";
import PreviewBanner from "../collab/PreviewBanner";
import RemoteCursors from "../collab/RemoteCursors";
import PresenceBar from "../collab/PresenceBar";
import AIChatPanel from "../ai/AIChatPanel";

const cloudSave = async () => {};
const canvasLayerSlot = <RemoteCursors />;
const headerActionsEndSlot = <PresenceBar />;
const versionsPanelSlot = <HistoryPanel />;
const rightPanelSlot = <AIChatPanel initialOpen={false} />;

function ProjectWorkspace() {
  const {
    projectId,
    projectName,
    status,
    role,
    ready,
    preview,
    waitForSnapshot,
    prepareCloudDiagram,
    canWrite,
  } = useProjectCollab();
  const { t } = useTranslation();
  const extensions = useMemo(
    () => ({
      projectMode: true,
      projectName,
      readOnly:
        status !== "online" || !ready || role === "viewer" || Boolean(preview),
      canWrite,
      cloudLoad: waitForSnapshot,
      prepareCloudDiagram,
      cloudSave,
      "canvas-layer": canvasLayerSlot,
      "header-actions-end": headerActionsEndSlot,
      "versions-panel": versionsPanelSlot,
      "right-panel": rightPanelSlot,
    }),
    [
      projectName,
      status,
      role,
      ready,
      preview,
      waitForSnapshot,
      prepareCloudDiagram,
      canWrite,
    ],
  );
  const editor = useMemo(
    () => (
      <ProjectContexts projectId={projectId}>
        {status !== "online" && (
          <div
            role="status"
            className="px-4 py-2 text-sm bg-amber-100 text-amber-950"
          >
            {t(status === "offline" ? "project_offline" : "project_connecting")}
          </div>
        )}
        <PreviewBanner />
      </ProjectContexts>
    ),
    [projectId, status, t],
  );
  return (
    <ExtensionsContext.Provider value={extensions}>
      {editor}
    </ExtensionsContext.Provider>
  );
}

export default function ProjectEditor() {
  const { id } = useParams();
  useThemedPage();
  return (
    <SettingsContextProvider>
      <ProjectCollabProvider key={id} projectId={id}>
        <ProjectWorkspace />
      </ProjectCollabProvider>
    </SettingsContextProvider>
  );
}

function ProjectContexts({ projectId, children }) {
  return (
    <div className="h-full flex flex-col">
      {children}
      <div className="flex-1 min-h-0">
        <LayoutContextProvider>
          <TransformContextProvider>
            <UndoRedoContextProvider>
              <SelectContextProvider>
                <AreasContextProvider>
                  <NotesContextProvider>
                    <TypesContextProvider>
                      <EnumsContextProvider>
                        <ViewsContextProvider>
                          <TablesContextProvider>
                            <SaveStateContextProvider>
                              <FocusContextProvider>
                                <CollabBridge />
                                <WorkSpace forcedDiagramId={projectId} />
                              </FocusContextProvider>
                            </SaveStateContextProvider>
                          </TablesContextProvider>
                        </ViewsContextProvider>
                      </EnumsContextProvider>
                    </TypesContextProvider>
                  </NotesContextProvider>
                </AreasContextProvider>
              </SelectContextProvider>
            </UndoRedoContextProvider>
          </TransformContextProvider>
        </LayoutContextProvider>
      </div>
    </div>
  );
}

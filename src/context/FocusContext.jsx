import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { useDiagram, useSettings, useTransform } from "../hooks";
import { FOCUS_DEPTHS, relatedTableIds } from "../utils/relatedTables";
import { fitTransform } from "../utils/fitView";
import { FLASH_MS } from "../utils/locate";
import { computeFocusedIds, resolveFocusAfterChange } from "./focusState";

export const FocusContext = createContext(null);
export const FocusActionsContext = createContext(null);

export default function FocusContextProvider({ children }) {
  const { t } = useTranslation();
  const { tables, relationships } = useDiagram();
  const { setTransform } = useTransform();
  const { settings } = useSettings();

  const [focusState, setFocusState] = useState(null);
  const [relatedRootId, setRelatedRootId] = useState(null);
  const [flashTableId, setFlashTableId] = useState(null);

  const flashTimerRef = useRef(null);
  const latestRef = useRef({
    tables,
    relationships,
    showComments: settings.showComments,
  });
  latestRef.current = {
    tables,
    relationships,
    showComments: settings.showComments,
  };

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusState && relatedRootId == null) return;
    const {
      focus: nextFocus,
      relatedRootId: nextRelatedRootId,
      focusRootDeleted,
      relatedRootDeleted,
    } = resolveFocusAfterChange(tables, focusState, relatedRootId);

    if (nextFocus !== focusState) {
      setFocusState(nextFocus);
    }
    if (nextRelatedRootId !== relatedRootId) {
      setRelatedRootId(nextRelatedRootId);
    }
    if (focusRootDeleted) {
      Toast.warning(t("focus_root_deleted"));
    }
    if (relatedRootDeleted) {
      Toast.warning(t("related_root_deleted"));
    }
  }, [tables, focusState, relatedRootId, t]);

  const startFocus = useCallback(
    (rootId, depth = 1) => {
      if (rootId == null) return;
      const nextDepth = FOCUS_DEPTHS.includes(depth) ? depth : 1;
      setFocusState({
        rootId,
        depth: nextDepth,
        extraIds: new Set(),
      });
      setRelatedRootId(null);

      const {
        tables: currentTables,
        relationships: currentRelationships,
        showComments,
      } = latestRef.current;
      const groupIds = relatedTableIds(currentRelationships, rootId, nextDepth);
      const groupTables = currentTables.filter((tbl) => groupIds.has(tbl.id));
      const canvasEl =
        typeof document !== "undefined"
          ? document.getElementById("canvas")
          : null;
      const next = fitTransform(
        { tables: groupTables, relationships: currentRelationships },
        canvasEl?.getBoundingClientRect(),
        showComments,
      );
      if (next) {
        setTransform((prev) => ({ ...prev, ...next }));
      }
    },
    [setTransform],
  );

  const setFocusDepth = useCallback((depth) => {
    const nextDepth = FOCUS_DEPTHS.includes(depth) ? depth : 1;
    setFocusState((prev) => (prev ? { ...prev, depth: nextDepth } : null));
  }, []);

  const exitFocus = useCallback(() => {
    setFocusState(null);
  }, []);

  const includeTable = useCallback((tableId) => {
    if (tableId == null) return;
    setFocusState((prev) => {
      if (!prev) return null;
      if (prev.extraIds.has(tableId)) return prev;
      const nextExtraIds = new Set(prev.extraIds);
      nextExtraIds.add(tableId);
      return { ...prev, extraIds: nextExtraIds };
    });
  }, []);

  const openRelated = useCallback((tableId) => {
    setRelatedRootId(tableId);
  }, []);

  const closeRelated = useCallback(() => {
    setRelatedRootId(null);
  }, []);

  const flashTable = useCallback((tableId) => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
    setFlashTableId(tableId);
    if (tableId != null) {
      flashTimerRef.current = setTimeout(() => {
        setFlashTableId((current) => (current === tableId ? null : current));
        flashTimerRef.current = null;
      }, FLASH_MS);
    }
  }, []);

  const actions = useMemo(
    () => ({
      startFocus,
      setFocusDepth,
      exitFocus,
      includeTable,
      openRelated,
      closeRelated,
      flashTable,
    }),
    [
      startFocus,
      setFocusDepth,
      exitFocus,
      includeTable,
      openRelated,
      closeRelated,
      flashTable,
    ],
  );

  const focus = useMemo(
    () =>
      focusState
        ? { rootId: focusState.rootId, depth: focusState.depth }
        : null,
    [focusState],
  );

  const focusedIds = useMemo(
    () => computeFocusedIds(relationships, focusState),
    [relationships, focusState],
  );

  const isTableDimmed = useCallback(
    (tableId) => {
      if (!focusedIds) return false;
      return !focusedIds.has(tableId);
    },
    [focusedIds],
  );

  const value = useMemo(
    () => ({
      ...actions,
      focus,
      focusedIds,
      isTableDimmed,
      relatedRootId,
      flashTableId,
    }),
    [actions, focus, focusedIds, isTableDimmed, relatedRootId, flashTableId],
  );

  return (
    <FocusActionsContext.Provider value={actions}>
      <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
    </FocusActionsContext.Provider>
  );
}

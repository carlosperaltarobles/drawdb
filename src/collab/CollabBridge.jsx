import { useEffect, useLayoutEffect, useMemo } from "react";
import {
  useAreas,
  useDiagram,
  useEnums,
  useNotes,
  useTransform,
  useTypes,
  useUndoRedo,
  useViews,
} from "../hooks";
import { useProjectCollab } from "./ProjectCollabProvider";
import { DOC_KEYS } from "./ProjectSession";
import * as viewStorage from "./viewStorage";

export default function CollabBridge() {
  const {
    tables,
    setTables,
    relationships,
    setRelationships,
    database,
    setDatabase,
    sqlHeader,
    setSqlHeader,
  } = useDiagram();
  const { notes, setNotes } = useNotes();
  const { areas, setAreas } = useAreas();
  const { views, setViews } = useViews();
  const { enums, setEnums } = useEnums();
  const { types, setTypes } = useTypes();
  const { transform } = useTransform();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { registerAppliers, observe, projectId, userId, ready } =
    useProjectCollab();
  const appliers = useMemo(
    () => ({
      tables: setTables,
      relationships: setRelationships,
      notes: setNotes,
      areas: setAreas,
      views: setViews,
      enums: setEnums,
      types: setTypes,
      database: setDatabase,
      sqlHeader: setSqlHeader,
    }),
    [
      setTables,
      setRelationships,
      setNotes,
      setAreas,
      setViews,
      setEnums,
      setTypes,
      setDatabase,
      setSqlHeader,
    ],
  );

  useLayoutEffect(
    () =>
      registerAppliers((next, previous, reset) => {
        for (const key of DOC_KEYS)
          if (next[key] !== previous?.[key]) appliers[key](next[key]);
        if (reset) {
          setUndoStack([]);
          setRedoStack([]);
        }
      }),
    [registerAppliers, appliers, setUndoStack, setRedoStack],
  );

  useLayoutEffect(() => {
    observe({
      tables,
      relationships,
      notes,
      areas,
      views,
      enums,
      types,
      database,
      sqlHeader,
    });
  }, [
    observe,
    tables,
    relationships,
    notes,
    areas,
    views,
    enums,
    types,
    database,
    sqlHeader,
  ]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => viewStorage.save(projectId, transform, userId),
      500,
    );
    return () => clearTimeout(timer);
  }, [projectId, userId, ready, transform]);
  return null;
}

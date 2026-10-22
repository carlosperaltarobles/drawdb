import { createContext, useState, useCallback } from "react";
import {
  Action,
  ObjectType,
  defaultNoteTheme,
  noteWidth,
} from "../data/constants";
import { useUndoRedo, useTransform, useSelect, useCollab } from "../hooks";
import { Toast } from "@douyinfe/semi-ui";
import { cascadePosition } from "../utils/rect";
import { useTranslation } from "react-i18next";
import { findById, newId, removeById } from "../utils/ids";

export const NotesContext = createContext(null);

export default function NotesContextProvider({ children }) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState([]);
  const { transform } = useTransform();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { selectedElement, setSelectedElement } = useSelect();
  const { emitDelta, isApplyingRemoteRef } = useCollab();
  const shouldEmit = () => !isApplyingRemoteRef?.current;

  const addNote = (data, addToHistory = true) => {
    let created = data;
    if (data) {
      setNotes((prev) => [...prev, data]);
    } else {
      const height = 88;
      created = {
        id: newId(),
        ...cascadePosition(
          { x: transform.pan.x, y: transform.pan.y - height / 2 },
          notes,
        ),
        title: `note_${notes.length}`,
        content: "",
        locked: false,
        color: defaultNoteTheme,
        height,
        width: noteWidth,
      };
      setNotes((prev) => [...prev, created]);
    }
    if (addToHistory) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.ADD,
          element: ObjectType.NOTE,
          data: created,
          message: t("add_note"),
        },
      ]);
      setRedoStack([]);
    }
    if (shouldEmit() && created) {
      emitDelta({
        target: "note",
        action: "create",
        entityId: created.id,
        data: [created],
      });
    }
  };

  const deleteNote = (id, addToHistory = true) => {
    const target = findById(notes, id);
    if (addToHistory && target) {
      Toast.success(t("note_deleted"));
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.DELETE,
          element: ObjectType.NOTE,
          data: target,
          message: t("delete_note", { noteTitle: target.title }),
        },
      ]);
      setRedoStack([]);
    }
    setNotes((prev) => removeById(prev, id));
    if (id === selectedElement.id) {
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.NONE,
        id: -1,
        open: false,
      }));
    }
    if (shouldEmit()) {
      emitDelta({
        target: "note",
        action: "delete",
        entityId: id,
        data: [id],
      });
    }
  };

  const updateNote = useCallback(
    (id, values) => {
      setNotes((prev) =>
        prev.map((t) => {
          if (t.id === id) {
            return {
              ...t,
              ...values,
            };
          }
          return t;
        }),
      );
      if (shouldEmit()) {
        emitDelta({
          target: "note",
          action: "update",
          entityId: id,
          data: [id, values],
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emitDelta],
  );

  return (
    <NotesContext.Provider
      value={{
        notes,
        setNotes,
        updateNote,
        addNote,
        deleteNote,
        notesCount: notes.length,
      }}
    >
      {children}
    </NotesContext.Provider>
  );
}

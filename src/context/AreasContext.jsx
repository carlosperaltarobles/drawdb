import { Toast } from "@douyinfe/semi-ui";
import { createContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { findById, newId, removeById } from "../utils/ids";
import { Action, ObjectType, defaultBlue } from "../data/constants";
import { useSelect, useTransform, useUndoRedo, useCollab } from "../hooks";
import { cascadePosition } from "../utils/rect";

export const AreasContext = createContext(null);

export default function AreasContextProvider({ children }) {
  const { t } = useTranslation();
  const [areas, setAreas] = useState([]);
  const { transform } = useTransform();
  const { selectedElement, setSelectedElement } = useSelect();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { emitDelta, isApplyingRemoteRef } = useCollab();
  const shouldEmit = () => !isApplyingRemoteRef?.current;

  const addArea = (data, addToHistory = true) => {
    let created = data;
    if (data) {
      setAreas((prev) => [...prev, data]);
    } else {
      const width = 200;
      const height = 200;
      created = {
        id: newId(),
        name: `area_${areas.length}`,
        ...cascadePosition(
          { x: transform.pan.x - width / 2, y: transform.pan.y - height / 2 },
          areas,
        ),
        width,
        height,
        color: defaultBlue,
        locked: false,
      };
      setAreas((prev) => [...prev, created]);
    }
    if (addToHistory) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.ADD,
          element: ObjectType.AREA,
          data: created,
          message: t("add_area"),
        },
      ]);
      setRedoStack([]);
    }
    if (shouldEmit() && created) {
      emitDelta({
        target: "area",
        action: "create",
        entityId: created.id,
        data: [created],
      });
    }
  };

  const deleteArea = (id, addToHistory = true) => {
    const target = findById(areas, id);
    if (addToHistory && target) {
      Toast.success(t("area_deleted"));
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.DELETE,
          element: ObjectType.AREA,
          data: target,
          message: t("delete_area", { areaName: target.name }),
        },
      ]);
      setRedoStack([]);
    }
    setAreas((prev) => removeById(prev, id));
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
        target: "area",
        action: "delete",
        entityId: id,
        data: [id],
      });
    }
  };

  const updateArea = (id, values) => {
    setAreas((prev) =>
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
        target: "area",
        action: "update",
        entityId: id,
        data: [id, values],
      });
    }
  };

  return (
    <AreasContext.Provider
      value={{
        areas,
        setAreas,
        updateArea,
        addArea,
        deleteArea,
        areasCount: areas.length,
      }}
    >
      {children}
    </AreasContext.Provider>
  );
}

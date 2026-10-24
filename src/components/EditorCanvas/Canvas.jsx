import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Slot, useExtensions } from "../../context/ExtensionsContext";
import {
  Action,
  Cardinality,
  Constraint,
  darkBgTheme,
  ObjectType,
  gridSize,
  gridCircleRadius,
  minAreaSize,
  defaultRelationshipColor,
} from "../../data/constants";
import { Toast } from "@douyinfe/semi-ui";
import Table from "./Table";
import View from "./View";
import Area from "./Area";
import Relationship from "./Relationship";
import Note from "./Note";
import {
  useCanvas,
  useSettings,
  useTransform,
  useDiagram,
  useUndoRedo,
  useSelect,
  useAreas,
  useNotes,
  useLayout,
  useSaveState,
  useCollab,
  useViews,
  useFocus,
} from "../../hooks";
import { useTranslation } from "react-i18next";
import { useEventListener } from "usehooks-ts";
import {
  areFieldsCompatible,
  getTableHeight,
  getTableWidth,
} from "../../utils/utils";
import {
  getViewHeight,
  getViewWidth,
  resolveViewColumns,
} from "../../utils/views";
import { getRectFromEndpoints, isInsideRect } from "../../utils/rect";
import { findById } from "../../utils/ids";
import {
  SIMPLIFIED_TABLE_ZOOM,
  cullBounds,
  cullElements,
} from "../../utils/culling";
import { State, noteWidth } from "../../data/constants";
import { nanoid } from "nanoid";

const notDragging = {
  id: -1,
  type: ObjectType.NONE,
  grabOffset: { x: 0, y: 0 },
};

export default function Canvas() {
  const { t } = useTranslation();

  const canvasRef = useRef(null);
  const canvasContextValue = useCanvas();
  const {
    canvas: { viewBox: screenViewBox },
    pointer,
  } = canvasContextValue;

  const { tables, updateTable, relationships, addRelationship, database } =
    useDiagram();
  const { setSaveState } = useSaveState();
  const { areas, updateArea } = useAreas();
  const { views, updateView } = useViews();
  const { notes, updateNote } = useNotes();
  const { layout } = useLayout();
  const {
    focusedIds = null,
    includeTable,
    flashTableId = null,
  } = useFocus() ?? {};
  // Exports draw the whole diagram; otherwise show what the transform frames.
  const exportBounds = layout.exportBounds;
  const exporting = exportBounds !== null;
  const dim = !exporting && focusedIds !== null;
  const viewBox = useMemo(
    () =>
      exportBounds
        ? new DOMRect(
            exportBounds.left,
            exportBounds.top,
            exportBounds.width,
            exportBounds.height,
          )
        : screenViewBox,
    [exportBounds, screenViewBox],
  );
  const { projectMode } = useExtensions();
  const { settings } = useSettings();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { transform, setTransform } = useTransform();
  const {
    selectedElement,
    setSelectedElement,
    bulkSelectedElements,
    setBulkSelectedElements,
  } = useSelect();
  const [dragging, setDragging] = useState(notDragging);
  const [linking, setLinking] = useState(false);
  const [linkingLine, setLinkingLine] = useState({
    startTableId: -1,
    startFieldId: -1,
    endTableId: -1,
    endFieldId: -1,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  });
  const { emitAwareness } = useCollab();
  const lastLinkingRef = useRef(false);
  const rightClickPanned = useRef(false);

  useEffect(() => {
    if (linking) {
      emitAwareness({
        linking: {
          startX: linkingLine.startX,
          startY: linkingLine.startY,
          endX: linkingLine.endX,
          endY: linkingLine.endY,
        },
      });
      lastLinkingRef.current = true;
    } else if (lastLinkingRef.current) {
      emitAwareness({ linking: null });
      lastLinkingRef.current = false;
    }
  }, [
    linking,
    linkingLine.startX,
    linkingLine.startY,
    linkingLine.endX,
    linkingLine.endY,
    emitAwareness,
  ]);
  const [hoveredTable, setHoveredTable] = useState({
    tableId: null,
    fieldId: null,
  });
  const [panning, setPanning] = useState({
    isPanning: false,
    panStart: { x: 0, y: 0 },
    cursorStart: { x: 0, y: 0 },
  });
  const [areaResize, setAreaResize] = useState({ id: -1, dir: "none" });
  const [areaInitDimensions, setAreaInitDimensions] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [bulkSelectRect, setBulkSelectRect] = useState({
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    show: false,
    ctrlKey: false,
    metaKey: false,
  });
  const elementPointerDownRef = useRef(null);
  const setPointerStyle = pointer.setStyle;

  useEffect(() => {
    setPointerStyle(layout.handTool ? "grab" : "default");
  }, [layout.handTool, setPointerStyle]);
  const handleElementPointerDown = useCallback((element, type) => {
    elementPointerDownRef.current = { element, type };
  }, []);

  const tablesById = useMemo(
    () => new Map(tables.map((table) => [table.id, table])),
    [tables],
  );

  const selectedTableIds = useMemo(() => {
    const ids = new Set(
      bulkSelectedElements
        .filter((el) => el.type === ObjectType.TABLE)
        .map((el) => el.id),
    );
    if (selectedElement.element === ObjectType.TABLE) {
      ids.add(selectedElement.id);
    }
    return ids;
  }, [bulkSelectedElements, selectedElement.element, selectedElement.id]);

  const tableBoxes = useMemo(
    () =>
      new Map(
        tables.map((t) => [
          t.id,
          {
            x: t.x,
            y: t.y,
            w: getTableWidth(t),
            h: getTableHeight(t, settings.showComments, relationships),
          },
        ]),
      ),
    [tables, relationships, settings.showComments],
  );

  // Only draw what is on (or near) the screen: large diagrams have thousands
  // of nodes and redrawing all of them on every pan step is what makes it slow.
  const rendered = useMemo(() => {
    const keepTableIds = new Set(selectedTableIds);
    if (dragging.type === ObjectType.TABLE) keepTableIds.add(dragging.id);
    if (linking) keepTableIds.add(linkingLine.startTableId);
    return cullElements({
      tables,
      relationships,
      boxes: tableBoxes,
      bounds: exporting ? null : cullBounds(viewBox),
      keepTableIds,
      keepRelationshipId:
        selectedElement.element === ObjectType.RELATIONSHIP
          ? selectedElement.id
          : null,
    });
  }, [
    tables,
    relationships,
    tableBoxes,
    viewBox,
    exporting,
    selectedTableIds,
    dragging.type,
    dragging.id,
    linking,
    linkingLine.startTableId,
    selectedElement.element,
    selectedElement.id,
  ]);
  const simplifiedTables = !exporting && transform.zoom < SIMPLIFIED_TABLE_ZOOM;

  const isSameElement = (el1, el2) => {
    return el1.id === el2.id && el1.type === el2.type;
  };

  const collectSelectedElements = () => {
    const rect = getRectFromEndpoints(bulkSelectRect);
    const elements = [];
    const shouldAddElement = (elementRect, element) => {
      // if ctrl key is pressed, only add the elements that are not already selected
      // can theoretically be optimized later if the selected elements is
      // a map from id to element (after the ids are made unique)
      return (
        isInsideRect(elementRect, rect) &&
        ((!bulkSelectRect.ctrlKey && !bulkSelectRect.metaKey) ||
          !bulkSelectedElements.some((el) => isSameElement(el, element)))
      );
    };

    tables.forEach((table) => {
      if (table.locked) return;
      if (dim && !focusedIds.has(table.id)) return;

      const element = {
        id: table.id,
        type: ObjectType.TABLE,
        currentCoords: { x: table.x, y: table.y },
        initialCoords: { x: table.x, y: table.y },
      };
      const tableRect = {
        x: table.x,
        y: table.y,
        width: getTableWidth(table),
        height: getTableHeight(table, settings.showComments, relationships),
      };
      if (shouldAddElement(tableRect, element)) {
        elements.push(element);
      }
    });

    if (!dim) {
      views.forEach((view) => {
        if (view.locked) return;

        const element = {
          id: view.id,
          type: ObjectType.VIEW,
          currentCoords: { x: view.x, y: view.y },
          initialCoords: { x: view.x, y: view.y },
        };
        const viewRect = {
          x: view.x,
          y: view.y,
          width: getViewWidth(view),
          height: getViewHeight(
            view,
            resolveViewColumns(view, tables),
            settings.showComments,
          ),
        };
        if (shouldAddElement(viewRect, element)) {
          elements.push(element);
        }
      });

      areas.forEach((area) => {
        if (area.locked) return;

        const element = {
          id: area.id,
          type: ObjectType.AREA,
          currentCoords: { x: area.x, y: area.y },
          initialCoords: { x: area.x, y: area.y },
        };
        const areaRect = {
          x: area.x,
          y: area.y,
          width: area.width,
          height: area.height,
        };
        if (shouldAddElement(areaRect, element)) {
          elements.push(element);
        }
      });

      notes.forEach((note) => {
        if (note.locked) return;

        const element = {
          id: note.id,
          type: ObjectType.NOTE,
          currentCoords: { x: note.x, y: note.y },
          initialCoords: { x: note.x, y: note.y },
        };
        const noteRect = {
          x: note.x,
          y: note.y,
          width: note.width ?? noteWidth,
          height: note.height,
        };
        if (shouldAddElement(noteRect, element)) {
          elements.push(element);
        }
      });
    }

    if (bulkSelectRect.ctrlKey || bulkSelectRect.metaKey) {
      setBulkSelectedElements([...bulkSelectedElements, ...elements]);
    } else {
      setBulkSelectedElements(elements);
    }
  };

  const handlePointerDownOnElement = (e, { element, type }) => {
    if (selectedElement.open && !layout.sidebar) return;

    if (!e.isPrimary) return;

    if (!element.locked || !(e.ctrlKey || e.metaKey)) {
      setSelectedElement((prev) => ({
        ...prev,
        element: type,
        id: element.id,
        open: false,
      }));
    }

    if (element.locked) {
      if (!(e.ctrlKey || e.metaKey)) {
        setBulkSelectedElements([]);
      }
      return;
    }

    setBulkSelectRect((prev) => ({
      ...prev,
      show: false,
    }));

    // this is the object that will be added to the bulk selected elements
    // if necessary
    const elementInBulk = {
      id: element.id,
      type,
      currentCoords: { x: element.x, y: element.y },
      initialCoords: { x: element.x, y: element.y },
    };

    const isSelected = bulkSelectedElements.some((el) =>
      isSameElement(el, elementInBulk),
    );

    if (e.ctrlKey || e.metaKey) {
      if (isSelected) {
        if (bulkSelectedElements.length > 1) {
          setBulkSelectedElements(
            bulkSelectedElements.filter(
              (el) => !isSameElement(el, elementInBulk),
            ),
          );
          setSelectedElement({
            ...selectedElement,
            element: ObjectType.NONE,
            id: -1,
            open: false,
          });
        }
      } else {
        setBulkSelectedElements([...bulkSelectedElements, elementInBulk]);
      }
      setDragging(notDragging);
      return;
    }

    if (!isSelected) {
      setBulkSelectedElements([elementInBulk]);
    }
    setDragging({
      id: element.id,
      type,
      grabOffset: {
        x: pointer.spaces.diagram.x - element.x,
        y: pointer.spaces.diagram.y - element.y,
      },
    });
  };

  const coordinatesAfterSnappingToGrid = ({ x, y }) => {
    if (settings.snapToGrid) {
      return {
        x: Math.round(x / gridSize) * gridSize,
        y: Math.round(y / gridSize) * gridSize,
      };
    }
    return { x, y };
  };

  /**
   * @param {PointerEvent} e
   */
  const handlePointerMove = (e) => {
    if (selectedElement.open && !layout.sidebar) return;

    if (!e.isPrimary) return;

    if (panning.isPanning) {
      // Read the cursor from the event: the pointer in context is one render behind.
      setTransform((prev) => ({
        ...prev,
        pan: {
          x:
            panning.panStart.x +
            (panning.cursorStart.x - e.clientX) / prev.zoom,
          y:
            panning.panStart.y +
            (panning.cursorStart.y - e.clientY) / prev.zoom,
        },
      }));
      return;
    }

    if (layout.readOnly) return;

    if (linking) {
      setLinkingLine({
        ...linkingLine,
        endX: pointer.spaces.diagram.x,
        endY: pointer.spaces.diagram.y,
      });
      return;
    }

    if (isDragging()) {
      const { x: mainElementFinalX, y: mainElementFinalY } =
        coordinatesAfterSnappingToGrid({
          x: pointer.spaces.diagram.x - dragging.grabOffset.x,
          y: pointer.spaces.diagram.y - dragging.grabOffset.y,
        });

      const { currentCoords } = bulkSelectedElements.find((el) =>
        isSameElement(el, dragging),
      );

      const deltaX = mainElementFinalX - currentCoords.x;
      const deltaY = mainElementFinalY - currentCoords.y;

      const newBulkSelectedElements = [];
      bulkSelectedElements.forEach((el) => {
        const elementFinalCoords = {
          x: el.currentCoords.x + deltaX,
          y: el.currentCoords.y + deltaY,
        };
        if (el.type === ObjectType.TABLE) {
          updateTable(el.id, { ...elementFinalCoords });
        }
        if (el.type === ObjectType.AREA) {
          updateArea(el.id, { ...elementFinalCoords });
        }
        if (el.type === ObjectType.NOTE) {
          updateNote(el.id, { ...elementFinalCoords });
        }
        if (el.type === ObjectType.VIEW) {
          updateView(el.id, { ...elementFinalCoords });
        }
        newBulkSelectedElements.push({
          ...el,
          currentCoords: elementFinalCoords,
        });
      });

      setBulkSelectedElements(newBulkSelectedElements);
      return;
    }

    if (areaResize.id !== -1) {
      if (areaResize.dir === "none") return;
      let newDims = { ...areaInitDimensions };
      setPanning((old) => ({ ...old, isPanning: false }));
      const { x, y } = coordinatesAfterSnappingToGrid(pointer.spaces.diagram);

      switch (areaResize.dir) {
        case "br":
          newDims.width = x - areaInitDimensions.x;
          newDims.height = y - areaInitDimensions.y;
          break;
        case "tl":
          newDims.x = x;
          newDims.y = y;
          newDims.width = areaInitDimensions.width - (x - areaInitDimensions.x);
          newDims.height =
            areaInitDimensions.height - (y - areaInitDimensions.y);
          break;
        case "tr":
          newDims.y = y;
          newDims.width = x - areaInitDimensions.x;
          newDims.height =
            areaInitDimensions.height - (y - areaInitDimensions.y);
          break;
        case "bl":
          newDims.x = x;
          newDims.width = areaInitDimensions.width - (x - areaInitDimensions.x);
          newDims.height = y - areaInitDimensions.y;
          break;
      }

      if (newDims.width <= minAreaSize) {
        newDims.width = minAreaSize;
        if (areaResize.dir === "tl" || areaResize.dir === "bl") {
          newDims.x =
            areaInitDimensions.x + areaInitDimensions.width - minAreaSize;
        }
      }

      if (newDims.height <= minAreaSize) {
        newDims.height = minAreaSize;
        if (areaResize.dir === "tl" || areaResize.dir === "tr") {
          newDims.y =
            areaInitDimensions.y + areaInitDimensions.height - minAreaSize;
        }
      }

      updateArea(areaResize.id, { ...newDims });
      return;
    }

    if (bulkSelectRect.show) {
      setBulkSelectRect((prev) => ({
        ...prev,
        x2: pointer.spaces.diagram.x,
        y2: pointer.spaces.diagram.y,
      }));
    }
  };

  /**
   * @param {PointerEvent} e
   */
  const handlePointerDown = (e) => {
    const elementPointerDown = elementPointerDownRef.current;
    elementPointerDownRef.current = null;

    if (!e.isPrimary) return;

    // don't pan if the sidesheet for editing a table is open
    if (
      (selectedElement.element === ObjectType.TABLE ||
        selectedElement.element === ObjectType.VIEW) &&
      selectedElement.open &&
      !layout.sidebar
    )
      return;

    const isMouseLeftButton = e.button === 0;
    const isMouseMiddleButton = e.button === 1;
    const isMouseRightButton = e.button === 2;

    if (layout.handTool && isMouseLeftButton) {
      // Navigation only: cancel whatever the element under the pointer started.
      setLinking(false);
      setDragging(notDragging);
      setAreaResize({ id: -1, dir: "none" });
      setPanning({
        isPanning: true,
        panStart: transform.pan,
        cursorStart: { x: e.clientX, y: e.clientY },
      });
      pointer.setStyle("grabbing");
      return;
    }

    if (isMouseLeftButton) {
      setBulkSelectRect({
        x1: pointer.spaces.diagram.x,
        y1: pointer.spaces.diagram.y,
        x2: pointer.spaces.diagram.x,
        y2: pointer.spaces.diagram.y,
        show: elementPointerDown === null || !elementPointerDown.element.locked,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      });
      if (elementPointerDown !== null) {
        handlePointerDownOnElement(e, elementPointerDown);
      }
      pointer.setStyle("crosshair");
    } else if (isMouseMiddleButton || isMouseRightButton) {
      if (isMouseRightButton) rightClickPanned.current = false;
      setPanning({
        isPanning: true,
        panStart: transform.pan,
        // Diagram space depends on the current panning, so use client
        // coordinates; only their difference matters.
        cursorStart: { x: e.clientX, y: e.clientY },
      });
      pointer.setStyle("grabbing");
    }
  };

  const isDragging = () => {
    return dragging.type !== ObjectType.NONE && dragging.id !== -1;
  };

  const didDrag = () => {
    if (!isDragging()) return false;
    // checking any element is sufficient
    const { currentCoords, initialCoords } = bulkSelectedElements[0];
    return (
      currentCoords.x !== initialCoords.x || currentCoords.y !== initialCoords.y
    );
  };

  const didResize = (id) => {
    const area = findById(areas, id);
    if (!area) return false;
    return !(
      area.x === areaInitDimensions.x &&
      area.y === areaInitDimensions.y &&
      area.width === areaInitDimensions.width &&
      area.height === areaInitDimensions.height
    );
  };

  const didPan = () =>
    !(
      transform.pan.x === panning.panStart.x &&
      transform.pan.y === panning.panStart.y
    );

  /**
   * @param {PointerEvent} e
   */
  const handlePointerUp = (e) => {
    if (selectedElement.open && !layout.sidebar) return;

    if (!e.isPrimary) return;

    if (didDrag()) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.MOVE,
          bulk: true,
          message: t("bulk_update"),
          elements: bulkSelectedElements.map((el) => ({
            id: el.id,
            type: el.type,
            undo: el.initialCoords,
            redo: el.currentCoords,
          })),
        },
      ]);
      setRedoStack([]);
      setBulkSelectedElements((prev) =>
        prev.map((el) => ({
          ...el,
          initialCoords: { ...el.currentCoords },
        })),
      );
    }

    if (bulkSelectRect.show) {
      setBulkSelectRect((prev) => ({
        ...prev,
        x2: pointer.spaces.diagram.x,
        y2: pointer.spaces.diagram.y,
        show: false,
      }));
      if (!isDragging()) {
        collectSelectedElements();
      }
    }
    setDragging(notDragging);

    if (panning.isPanning && didPan()) {
      // In a project the view is local to each user, so panning saves nothing.
      if (!projectMode) setSaveState(State.SAVING);
      if (e.button === 2) rightClickPanned.current = true;
    }
    setPanning((old) => ({ ...old, isPanning: false }));
    pointer.setStyle(layout.handTool ? "grab" : "default");

    if (linking) handleLinking();
    setLinking(false);

    if (areaResize.id !== -1 && didResize(areaResize.id)) {
      setUndoStack((prev) => [
        ...prev,
        {
          action: Action.EDIT,
          element: ObjectType.AREA,
          aid: areaResize.id,
          undo: {
            ...findById(areas, areaResize.id),
            x: areaInitDimensions.x,
            y: areaInitDimensions.y,
            width: areaInitDimensions.width,
            height: areaInitDimensions.height,
          },
          redo: findById(areas, areaResize.id),
          message: t("edit_area", {
            areaName: findById(areas, areaResize.id).name,
            extra: "[resize]",
          }),
        },
      ]);
      setRedoStack([]);
    }
    setAreaResize({ id: -1, dir: "none" });
    setAreaInitDimensions({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  };

  const handleGripField = useCallback(() => {
    setPanning((old) => ({ ...old, isPanning: false }));
    setDragging(notDragging);
    setLinking(true);
  }, []);

  const getCardinality = (startField, endField) => {
    const startIsUnique = startField.unique || startField.primary;
    const endIsUnique = endField.unique || endField.primary;

    if (startIsUnique && endIsUnique) {
      return Cardinality.ONE_TO_ONE;
    }

    if (startIsUnique && !endIsUnique) {
      return Cardinality.ONE_TO_MANY;
    }

    if (!startIsUnique && endIsUnique) {
      return Cardinality.MANY_TO_ONE;
    }

    return Cardinality.ONE_TO_ONE;
  };

  const handleLinking = () => {
    if (hoveredTable.tableId === null) return;
    if (hoveredTable.fieldId === null) return;

    const { fields: startTableFields, name: startTableName } = tables.find(
      (t) => t.id === linkingLine.startTableId,
    );
    const startField = startTableFields.find(
      (f) => f.id === linkingLine.startFieldId,
    );
    const { fields: endTableFields, name: endTableName } = tables.find(
      (t) => t.id === hoveredTable.tableId,
    );
    const endField = endTableFields.find((f) => f.id === hoveredTable.fieldId);

    if (!areFieldsCompatible(database, startField.type, endField.type)) {
      Toast.info(t("cannot_connect"));
      return;
    }
    if (
      linkingLine.startTableId === hoveredTable.tableId &&
      linkingLine.startFieldId === hoveredTable.fieldId
    )
      return;

    const cardinality = getCardinality(startField, endField);

    const newRelationship = {
      ...linkingLine,
      cardinality,
      endTableId: hoveredTable.tableId,
      endFieldId: hoveredTable.fieldId,
      fields: [
        {
          startFieldId: linkingLine.startFieldId,
          endFieldId: hoveredTable.fieldId,
        },
      ],
      updateConstraint: Constraint.NONE,
      deleteConstraint: Constraint.NONE,
      name: `fk_${startTableName}_${startField.name}_${endTableName}`,
      color: defaultRelationshipColor,
      id: nanoid(),
    };
    delete newRelationship.startX;
    delete newRelationship.startY;
    delete newRelationship.endX;
    delete newRelationship.endY;
    addRelationship(newRelationship);
    if (focusedIds !== null) {
      includeTable?.(hoveredTable.tableId);
    }
  };

  useEventListener(
    "wheel",
    (e) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        const eagernessFactor = 0.05;
        setTransform((prev) => ({
          pan: {
            x:
              prev.pan.x -
              (pointer.spaces.diagram.x - prev.pan.x) *
                eagernessFactor *
                Math.sign(e.deltaY),
            y:
              prev.pan.y -
              (pointer.spaces.diagram.y - prev.pan.y) *
                eagernessFactor *
                Math.sign(e.deltaY),
          },
          zoom: e.deltaY <= 0 ? prev.zoom * 1.05 : prev.zoom / 1.05,
        }));
      } else if (e.shiftKey) {
        setTransform((prev) => ({
          ...prev,
          pan: {
            ...prev.pan,
            x: prev.pan.x + e.deltaY / prev.zoom,
          },
        }));
      } else {
        setTransform((prev) => ({
          ...prev,
          pan: {
            ...prev.pan,
            x: prev.pan.x + e.deltaX / prev.zoom,
            y: prev.pan.y + e.deltaY / prev.zoom,
          },
        }));
      }
    },
    canvasRef,
    { passive: false },
  );

  return (
    <>
      <div
        className={`grow h-full touch-none ${layout.handTool ? "hand-tool" : ""}`}
        id="canvas"
      >
        <div
          className="w-full h-full"
          style={{
            cursor: pointer.style,
            backgroundColor: settings.mode === "dark" ? darkBgTheme : "white",
          }}
        >
          <svg
            id="diagram"
            ref={canvasRef}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onContextMenu={(e) => {
              if (rightClickPanned.current) {
                e.preventDefault();
                rightClickPanned.current = false;
              }
            }}
            className="absolute w-full h-full touch-none"
            viewBox={`${viewBox.left} ${viewBox.top} ${viewBox.width} ${viewBox.height}`}
          >
            {settings.showGrid && (
              <>
                <defs>
                  <pattern
                    id="pattern-grid"
                    x={-gridCircleRadius}
                    y={-gridCircleRadius}
                    width={gridSize}
                    height={gridSize}
                    patternUnits="userSpaceOnUse"
                    patternContentUnits="userSpaceOnUse"
                  >
                    <circle
                      cx={gridCircleRadius}
                      cy={gridCircleRadius}
                      r={gridCircleRadius}
                      fill="rgb(99, 152, 191)"
                      opacity="1"
                    />
                  </pattern>
                </defs>
                <rect
                  x={viewBox.left}
                  y={viewBox.top}
                  width={viewBox.width}
                  height={viewBox.height}
                  fill="url(#pattern-grid)"
                />
              </>
            )}
            {areas.map((a) => (
              <Area
                key={a.id}
                data={a}
                dimmed={dim}
                setResize={setAreaResize}
                setInitDimensions={setAreaInitDimensions}
                onPointerDown={handleElementPointerDown}
              />
            ))}
            {rendered.relationships.map((e) => (
              <Relationship
                key={e.id}
                data={e}
                startTable={tablesById.get(e.startTableId)}
                endTable={tablesById.get(e.endTableId)}
                relationships={relationships}
                editOpen={
                  selectedElement.open &&
                  !layout.sidebar &&
                  selectedElement.element === ObjectType.RELATIONSHIP &&
                  selectedElement.id === e.id
                }
                dimmed={
                  dim &&
                  !(
                    focusedIds.has(e.startTableId) &&
                    focusedIds.has(e.endTableId)
                  )
                }
              />
            ))}
            {rendered.tables.map((table) => (
              <Table
                key={table.id}
                tableData={table}
                isSelected={selectedTableIds.has(table.id)}
                editOpen={
                  selectedElement.open &&
                  !layout.sidebar &&
                  selectedElement.element === ObjectType.TABLE &&
                  selectedElement.id === table.id
                }
                zoom={transform.zoom}
                simplified={simplifiedTables}
                database={database}
                relationships={relationships}
                dimmed={dim && !focusedIds.has(table.id)}
                linking={linking}
                flashing={flashTableId === table.id}
                setHoveredTable={setHoveredTable}
                handleGripField={handleGripField}
                setLinkingLine={setLinkingLine}
                onPointerDown={handleElementPointerDown}
              />
            ))}
            {views.map((view) => (
              <View
                key={view.id}
                viewData={view}
                dimmed={dim}
                onPointerDown={handleElementPointerDown}
              />
            ))}
            {linking && (
              <path
                d={`M ${linkingLine.startX} ${linkingLine.startY} L ${linkingLine.endX} ${linkingLine.endY}`}
                stroke="red"
                strokeDasharray="8,8"
                className="pointer-events-none touch-none"
              />
            )}
            {!exporting && <Slot name="svg-overlay" />}
            {notes.map((n) => (
              <Note
                key={n.id}
                data={n}
                dimmed={dim}
                onPointerDown={handleElementPointerDown}
              />
            ))}
            {bulkSelectRect.show && (
              <rect
                {...getRectFromEndpoints(bulkSelectRect)}
                stroke="grey"
                fill="grey"
                fillOpacity={0.15}
                strokeDasharray={10}
              />
            )}
          </svg>
        </div>
        {settings.showDebugCoordinates && (
          <div className="fixed flex flex-col flex-wrap gap-6 bg-[rgba(var(--semi-grey-1),var(--tw-bg-opacity))]/40 border border-color bottom-4 right-4 p-4 rounded-xl backdrop-blur-xs pointer-events-none select-none">
            <table className="table-auto grow">
              <thead>
                <tr>
                  <th className="text-left" colSpan={3}>
                    {t("transform")}
                  </th>
                </tr>
                <tr className="italic [&_th]:font-normal [&_th]:text-right">
                  <th>pan x</th>
                  <th>pan y</th>
                  <th>scale</th>
                </tr>
              </thead>
              <tbody className="[&_td]:text-right [&_td]:min-w-[8ch]">
                <tr>
                  <td>{transform.pan.x.toFixed(2)}</td>
                  <td>{transform.pan.y.toFixed(2)}</td>
                  <td>{transform.zoom.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
            <table className="table-auto grow [&_th]:text-left [&_th:not(:first-of-type)]:text-right [&_td:not(:first-of-type)]:text-right [&_td]:min-w-[8ch]">
              <thead>
                <tr>
                  <th colSpan={4}>{t("viewbox")}</th>
                </tr>
                <tr className="italic [&_th]:font-normal">
                  <th>left</th>
                  <th>top</th>
                  <th>width</th>
                  <th>height</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{viewBox.left.toFixed(2)}</td>
                  <td>{viewBox.top.toFixed(2)}</td>
                  <td>{viewBox.width.toFixed(2)}</td>
                  <td>{viewBox.height.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <table className="table-auto grow [&_th]:text-left [&_th:not(:first-of-type)]:text-right [&_td:not(:first-of-type)]:text-right [&_td]:min-w-[8ch]">
              <thead>
                <tr>
                  <th colSpan={3}>{t("cursor_coordinates")}</th>
                </tr>
                <tr className="italic [&_th]:font-normal">
                  <th>{t("coordinate_space")}</th>
                  <th>x</th>
                  <th>y</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("coordinate_space_screen")}</td>
                  <td>{pointer.spaces.screen.x.toFixed(2)}</td>
                  <td>{pointer.spaces.screen.y.toFixed(2)}</td>
                </tr>
                <tr>
                  <td>{t("coordinate_space_diagram")}</td>
                  <td>{pointer.spaces.diagram.x.toFixed(2)}</td>
                  <td>{pointer.spaces.diagram.y.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* Outside #canvas so image exports do not capture it. */}
      {simplifiedTables && tables.length > 0 && (
        <div
          role="status"
          className={`absolute top-3 left-1/2 -translate-x-1/2 z-10 max-w-[90%] px-3 py-1 rounded-lg border text-xs shadow-sm pointer-events-none select-none ${
            settings.mode === "light"
              ? "bg-white/90 border-zinc-200 text-zinc-700"
              : "bg-zinc-800/90 border-zinc-700 text-zinc-200"
          }`}
        >
          <i className="fa-solid fa-magnifying-glass-plus me-2" />
          {t("simplified_view_hint", {
            zoom: Math.round(SIMPLIFIED_TABLE_ZOOM * 100),
          })}
        </div>
      )}
    </>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { IconKeyStroked } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import {
  darkBgTheme,
  gridCircleRadius,
  gridSize,
} from "../../data/constants";
import { useSettings } from "../../hooks";
import { calcCompositePath, calcPath } from "../../utils/calcPath";
import { fitTransform } from "../../utils/fitView";
import {
  getRelationshipFields,
  getTableHeight,
  getTableWidth,
  getVisibleFieldIndex,
  getVisibleFields,
} from "../../utils/utils";

const DEFAULT_CONTAINER_SIZE = { width: 960, height: 540 };
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;

function buildRelationshipPath(
  rel,
  startTable,
  endTable,
  relationships,
  showComments,
) {
  const startFields = getVisibleFields(startTable, relationships);
  const endFields = getVisibleFields(endTable, relationships);
  const pairs = getRelationshipFields(rel);

  const resolveIdx = (table, fieldId) => {
    const idx = getVisibleFieldIndex(table, fieldId, relationships);
    return idx >= 0 ? idx : 0;
  };

  const startFieldIndex = resolveIdx(
    startTable,
    rel.startFieldId ?? pairs[0]?.startFieldId,
  );
  const endFieldIndex = resolveIdx(
    endTable,
    rel.endFieldId ?? pairs[0]?.endFieldId,
  );
  const startFieldIndices = pairs.map((p) =>
    resolveIdx(startTable, p.startFieldId),
  );
  const endFieldIndices = pairs.map((p) => resolveIdx(endTable, p.endFieldId));

  const pathValues = {
    startFieldIndex,
    endFieldIndex,
    startFieldIndices,
    endFieldIndices,
    startTable: {
      x: startTable.x,
      y: startTable.y,
      width: getTableWidth(startTable),
      comment: startTable.comment,
      fields: startFields,
    },
    endTable: {
      x: endTable.x,
      y: endTable.y,
      width: getTableWidth(endTable),
      comment: endTable.comment,
      fields: endFields,
    },
  };

  if (startFieldIndices.length > 1) {
    return calcCompositePath(pathValues, 1, showComments)?.path ?? "";
  }

  return calcPath(pathValues, 1, showComments);
}

export function RelatedDiagram({
  tables = [],
  relationships = [],
  rootId,
  showComments,
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const effectiveShowComments = showComments ?? settings?.showComments ?? false;
  const isDark = settings?.mode === "dark";
  const showGrid = settings?.showGrid ?? true;
  const showDataTypes = settings?.showDataTypes ?? true;

  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [containerSize, setContainerSize] = useState(DEFAULT_CONTAINER_SIZE);

  const tablesKey = useMemo(
    () => tables.map((tbl) => tbl.id).sort().join(","),
    [tables],
  );

  const fittedTransform = useMemo(
    () =>
      fitTransform(
        { tables, relationships },
        containerSize,
        effectiveShowComments,
      ) ?? { pan: { x: 0, y: 0 }, zoom: 1 },
    [tables, relationships, containerSize, effectiveShowComments],
  );

  const [transform, setTransform] = useState(fittedTransform);
  const [appliedFitKey, setAppliedFitKey] = useState(
    `${rootId ?? ""}:${tablesKey}:${containerSize.width}x${containerSize.height}`,
  );

  const currentFitKey = `${rootId ?? ""}:${tablesKey}:${containerSize.width}x${containerSize.height}`;
  if (appliedFitKey !== currentFitKey) {
    setAppliedFitKey(currentFitKey);
    setTransform(fittedTransform);
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize((prev) =>
          prev.width === rect.width && prev.height === rect.height
            ? prev
            : { width: rect.width, height: rect.height },
        );
      }
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return undefined;

    const handleWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY <= 0 ? 1.08 : 1 / 1.08;
      const rect = svgEl.getBoundingClientRect();

      setTransform((prev) => {
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prev.zoom * factor),
        );
        if (!(rect?.width > 0) || !(rect?.height > 0)) {
          return { ...prev, zoom: nextZoom };
        }
        const offsetX = e.clientX - rect.left - rect.width / 2;
        const offsetY = e.clientY - rect.top - rect.height / 2;
        const diagramX = prev.pan.x + offsetX / prev.zoom;
        const diagramY = prev.pan.y + offsetY / prev.zoom;
        return {
          zoom: nextZoom,
          pan: {
            x: diagramX - offsetX / nextZoom,
            y: diagramY - offsetY / nextZoom,
          },
        };
      });
    };

    svgEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => svgEl.removeEventListener("wheel", handleWheel);
  }, []);

  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef(null);

  const handlePointerDown = (e) => {
    if (!e.isPrimary && e.button !== 0) return;
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      pan: transform.pan,
    };
    setIsPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isPanning || !panStartRef.current) return;
    const { clientX, clientY, pan } = panStartRef.current;
    setTransform((prev) => ({
      ...prev,
      pan: {
        x: pan.x + (clientX - e.clientX) / prev.zoom,
        y: pan.y + (clientY - e.clientY) / prev.zoom,
      },
    }));
  };

  const handlePointerUp = (e) => {
    if (!isPanning) return;
    setIsPanning(false);
    panStartRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const tablesById = useMemo(
    () => new Map(tables.map((tbl) => [tbl.id, tbl])),
    [tables],
  );

  const viewBox = useMemo(() => {
    const zoom = transform.zoom || 1;
    const width = containerSize.width / zoom;
    const height = containerSize.height / zoom;
    return {
      left: transform.pan.x - width / 2,
      top: transform.pan.y - height / 2,
      width,
      height,
    };
  }, [
    containerSize.height,
    containerSize.width,
    transform.pan.x,
    transform.pan.y,
    transform.zoom,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      style={{
        backgroundColor: isDark ? darkBgTheme : "white",
        cursor: isPanning ? "grabbing" : "grab",
      }}
    >
      <svg
        ref={svgRef}
        className="w-full h-full touch-none"
        viewBox={`${viewBox.left} ${viewBox.top} ${viewBox.width} ${viewBox.height}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {showGrid && (
          <>
            <defs>
              <pattern
                id="related-pattern-grid"
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
              fill="url(#related-pattern-grid)"
            />
          </>
        )}

        {relationships.map((rel) => {
          const startTable = tablesById.get(rel.startTableId);
          const endTable = tablesById.get(rel.endTableId);
          if (!startTable || !endTable) return null;

          const d = buildRelationshipPath(
            rel,
            startTable,
            endTable,
            relationships,
            effectiveShowComments,
          );
          if (!d) return null;

          return (
            <path
              key={rel.id}
              d={d}
              fill="none"
              stroke={rel.color || "#888"}
              strokeWidth={2}
              className="relationship-path pointer-events-none"
            />
          );
        })}

        {tables.map((table) => {
          const width = getTableWidth(table);
          const height = getTableHeight(
            table,
            effectiveShowComments,
            relationships,
          );
          const visibleFields = getVisibleFields(table, relationships);
          const isRoot = table.id === rootId;
          const isHidden = Boolean(table.hidden);

          const borderClasses = isRoot
            ? "border-blue-500 ring-2 ring-blue-500/40"
            : isDark
              ? "border-zinc-600"
              : "border-zinc-300";

          return (
            <foreignObject
              key={table.id}
              x={table.x}
              y={table.y}
              width={width}
              height={height}
              className="drop-shadow-md rounded-md pointer-events-none"
            >
              <div
                data-table-id={table.id}
                data-root={isRoot ? "true" : undefined}
                data-hidden={isHidden ? "true" : undefined}
                className={`border-2 ${
                  isHidden ? "border-dashed" : "border-solid"
                } ${borderClasses} select-none rounded-lg w-full ${
                  isDark
                    ? "bg-zinc-800 text-zinc-200"
                    : "bg-zinc-100 text-zinc-800"
                }`}
                style={{ direction: "ltr" }}
              >
                <div
                  className="h-[10px] w-full rounded-t-md"
                  style={{ backgroundColor: table.color }}
                />
                <div
                  className={`${
                    visibleFields.length === 0
                      ? "rounded-b-md"
                      : "border-b border-gray-400"
                  } ${isDark ? "bg-zinc-900" : "bg-zinc-100"} ${
                    table.comment && effectiveShowComments ? "pb-3" : ""
                  }`}
                >
                  <div className="overflow-hidden font-bold h-[40px] px-3 flex justify-between items-center gap-2">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1">
                      {table.name}
                    </span>
                    {isHidden && (
                      <span className="text-xs font-normal px-1.5 py-0.5 rounded border border-dashed border-current opacity-80 shrink-0">
                        {t("related_hidden_badge")}
                      </span>
                    )}
                  </div>
                  {table.comment && effectiveShowComments && (
                    <div className="text-xs px-3 line-clamp-5">
                      {table.comment}
                    </div>
                  )}
                </div>

                {visibleFields.map((field, idx) => (
                  <div
                    key={field.id ?? idx}
                    className={`${
                      idx === visibleFields.length - 1
                        ? ""
                        : "border-b border-gray-400"
                    } w-full overflow-hidden`}
                  >
                    <div className="h-[36px] px-2 py-1 flex justify-between items-center gap-1">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="shrink-0 w-[10px] h-[10px] bg-[#2f68adcc] rounded-full" />
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                          {field.name}
                        </span>
                      </div>
                      {showDataTypes && (
                        <div className="text-zinc-400 flex gap-1 items-center shrink-0">
                          {field.primary && <IconKeyStroked size="small" />}
                          {!field.notNull && (
                            <span className="font-mono">?</span>
                          )}
                          <span className="font-mono">
                            {field.type +
                              (field.size && field.size !== ""
                                ? `(${field.size})`
                                : "")}
                          </span>
                        </div>
                      )}
                    </div>
                    {field.comment && effectiveShowComments && (
                      <div className="ms-3 px-3 pb-3">
                        <div
                          className={`text-xs line-clamp-2 ${
                            isDark ? "text-zinc-200" : "text-zinc-600"
                          }`}
                        >
                          {field.comment}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}

export default RelatedDiagram;


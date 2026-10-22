import { memo, useEffect, useMemo, useRef } from "react";
import { useCanvas, useTransform } from "../hooks";
import { useProjectCollab } from "./ProjectCollabProvider";
import { colorFor } from "./colors";
import { throttle } from "./throttle";

export function normalizeLinking(linking) {
  if (!linking) return null;
  const startX = linking.startX ?? linking.x1 ?? linking.from?.x;
  const startY = linking.startY ?? linking.y1 ?? linking.from?.y;
  const endX = linking.endX ?? linking.x2 ?? linking.to?.x;
  const endY = linking.endY ?? linking.y2 ?? linking.to?.y;
  return [startX, startY, endX, endY].every(Number.isFinite)
    ? { startX, startY, endX, endY }
    : null;
}

const RemoteCursorItem = memo(function RemoteCursorItem({ x, y, name, color }) {
  return (
    <div
      data-testid="remote-cursor"
      className="pointer-events-none absolute left-0 top-0 select-none"
      style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 3L20 11L12 13L9 21L4 3Z"
          fill={color}
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="ml-3 -mt-1 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white shadow"
        style={{ backgroundColor: color }}
      >
        {name}
      </span>
    </div>
  );
});

const RemoteLinkingLine = memo(function RemoteLinkingLine({
  x1,
  y1,
  x2,
  y2,
  color,
}) {
  return (
    <line
      data-testid="remote-linking-line"
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={color}
      strokeWidth="2"
      strokeDasharray="8,8"
    />
  );
});

export const RemoteCursors = memo(function RemoteCursors() {
  const collab = useProjectCollab();
  const awareness = collab?.awareness;
  const sendAwareness = collab?.sendAwareness;
  const canvasCtx = useCanvas();
  useTransform();

  const diagramCursor = canvasCtx?.pointer?.spaces?.diagram;
  const toScreenSpace =
    canvasCtx?.coords?.toScreenSpace ?? canvasCtx?.toScreenSpace;

  const layerRef = useRef(null);
  const pointerOutsideRef = useRef(false);

  const throttledSendCursor = useMemo(
    () => throttle((cursor) => sendAwareness?.({ cursor }), 50),
    [sendAwareness],
  );

  useEffect(() => () => throttledSendCursor.cancel(), [throttledSendCursor]);

  const diagramX = diagramCursor?.x;
  const diagramY = diagramCursor?.y;

  useEffect(() => {
    if (pointerOutsideRef.current) return;
    if (!Number.isFinite(diagramX) || !Number.isFinite(diagramY)) return;
    throttledSendCursor({ x: diagramX, y: diagramY });
  }, [diagramX, diagramY, throttledSendCursor]);

  useEffect(() => {
    const target = layerRef.current?.parentElement;
    if (!target) return;
    const onActive = () => {
      pointerOutsideRef.current = false;
    };
    const onLeave = () => {
      pointerOutsideRef.current = true;
      throttledSendCursor.cancel();
      sendAwareness?.({ cursor: null });
    };
    target.addEventListener("pointerenter", onActive);
    target.addEventListener("pointerdown", onActive);
    target.addEventListener("pointermove", onActive);
    target.addEventListener("pointerleave", onLeave);
    return () => {
      target.removeEventListener("pointerenter", onActive);
      target.removeEventListener("pointerdown", onActive);
      target.removeEventListener("pointermove", onActive);
      target.removeEventListener("pointerleave", onLeave);
    };
  }, [sendAwareness, throttledSendCursor]);

  const entries = !awareness
    ? []
    : awareness instanceof Map
      ? Array.from(awareness.entries())
      : Object.entries(awareness);

  const cursors = [];
  const lines = [];
  const convert =
    typeof toScreenSpace === "function" ? toScreenSpace : (pt) => pt;

  for (const [peerId, state] of entries) {
    if (!state) continue;
    const color = state.color || colorFor(String(peerId));
    const name = state.name || String(peerId);

    if (
      state.cursor &&
      Number.isFinite(state.cursor.x) &&
      Number.isFinite(state.cursor.y)
    ) {
      const pt = convert(state.cursor);
      if (Number.isFinite(pt?.x) && Number.isFinite(pt?.y)) {
        cursors.push({ id: peerId, x: pt.x, y: pt.y, name, color });
      }
    }

    const raw = normalizeLinking(state.linking);
    if (raw) {
      const s = convert({ x: raw.startX, y: raw.startY });
      const e = convert({ x: raw.endX, y: raw.endY });
      if ([s?.x, s?.y, e?.x, e?.y].every(Number.isFinite)) {
        lines.push({ id: peerId, x1: s.x, y1: s.y, x2: e.x, y2: e.y, color });
      }
    }
  }

  return (
    <div
      ref={layerRef}
      data-testid="remote-cursors-layer"
      className="pointer-events-none absolute inset-0 overflow-hidden z-10"
    >
      {lines.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          {lines.map((l) => (
            <RemoteLinkingLine key={l.id} {...l} />
          ))}
        </svg>
      )}
      {cursors.map((c) => (
        <RemoteCursorItem key={c.id} {...c} />
      ))}
    </div>
  );
});

export default RemoteCursors;

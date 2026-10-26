import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCanvas, useTransform } from "../hooks";
import { useProjectCollab } from "../collab/ProjectCollabProvider";
import { buildProposalMarkers } from "./proposalMarkers";

const CHANGE_STYLES = {
  added: {
    stroke: "#10b981",
    fill: "rgba(16, 185, 129, 0.08)",
    badgeBg: "#059669",
    i18nKey: "ai_change_added",
  },
  modified: {
    stroke: "#f59e0b",
    fill: "rgba(245, 158, 11, 0.08)",
    badgeBg: "#d97706",
    i18nKey: "ai_change_modified",
  },
  removed: {
    stroke: "#ef4444",
    fill: "rgba(239, 68, 68, 0.10)",
    badgeBg: "#dc2626",
    i18nKey: "ai_change_removed",
  },
};

export const ProposalPreviewLayer = memo(function ProposalPreviewLayer({
  viewBox: propViewBox,
  zoom: propZoom,
} = {}) {
  const collab = useProjectCollab();
  const canvasCtx = useCanvas();
  const transformCtx = useTransform();
  const { t } = useTranslation();

  const preview = collab?.preview;
  const viewBox =
    propViewBox !== undefined ? propViewBox : canvasCtx?.canvas?.viewBox ?? null;
  const zoom =
    propZoom !== undefined
      ? propZoom
      : transformCtx?.transform?.zoom ?? 1;

  const { markers, ghosts, simplified } = useMemo(() => {
    if (!preview || preview.kind !== "ai") {
      return { markers: [], ghosts: [], simplified: false };
    }
    return buildProposalMarkers(preview, { viewBox, zoom });
  }, [preview, viewBox, zoom]);

  if (!preview || preview.kind !== "ai") return null;

  const allItems = [...markers, ...ghosts];
  const scale = Math.max(0.25, Math.min(2.5, 1 / Math.max(zoom, 0.1)));

  return (
    <g
      data-testid="ai-proposal-markers"
      data-simplified={simplified ? "true" : "false"}
      className="pointer-events-none select-none"
    >
      {allItems.map((m) => {
        const style = CHANGE_STYLES[m.change] ?? CHANGE_STYLES.modified;
        const badgeText = simplified
          ? m.change === "added"
            ? "+"
            : m.change === "removed"
              ? "-"
              : "~"
          : `${t(style.i18nKey)}: ${m.label}`;
        const pillHeight = 20 * scale;
        const pillWidth = Math.max(
          28 * scale,
          Math.min(260 * scale, (badgeText.length * 7 + 16) * scale),
        );

        return (
          <g
            key={m.key}
            data-testid={`ai-marker-${m.coll}-${m.id}`}
            data-change={m.change}
            data-ghost={m.isGhost ? "true" : "false"}
          >
            <rect
              x={m.x - 4}
              y={m.y - 4}
              width={m.w + 8}
              height={m.h + 8}
              rx={10}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={m.isGhost ? 2.5 : 3}
              strokeDasharray={m.isGhost ? "8,6" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={m.x}
              y={m.y - pillHeight - 4 * scale}
              width={pillWidth}
              height={pillHeight}
              rx={4 * scale}
              fill={style.badgeBg}
            />
            <text
              x={m.x + 8 * scale}
              y={m.y - pillHeight / 2 - 4 * scale}
              fill="#ffffff"
              fontSize={11 * scale}
              fontWeight="bold"
              dominantBaseline="central"
            >
              {badgeText}
            </text>
          </g>
        );
      })}
    </g>
  );
});

export default ProposalPreviewLayer;

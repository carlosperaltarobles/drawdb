import { tableColorStripHeight, tableHeaderHeight } from "../../data/constants";
import { getCommentHeight, getFieldHeight } from "../../utils/utils";

const COLOR_STRIP_HEIGHT = 10;

/**
 * SVG-only table drawn when the canvas is zoomed far out. Field text is not
 * readable at that size anyway, and skipping the HTML and shadows keeps large
 * diagrams smooth to pan and zoom. The name is drawn large so tables are easy
 * to find.
 */
export default function SimplifiedTable({
  table,
  fields,
  width,
  height,
  zoom,
  isSelected,
  darkMode,
  showComments,
  onPointerDown,
  onDoubleClick,
}) {
  const { x, y } = table;

  let rowY =
    y +
    tableColorStripHeight +
    tableHeaderHeight +
    getCommentHeight(table.comment, width, showComments);
  let rows = `M${x} ${rowY}h${width}`;
  for (let i = 0; i < fields.length - 1; i++) {
    rowY += getFieldHeight(fields[i], width, showComments);
    rows += `M${x} ${rowY}h${width}`;
  }

  // About 14px on screen, but never wider or taller than the table.
  const name = table.name || " ";
  const fontSize = Math.min(
    14 / zoom,
    (width - 16) / (name.length * 0.6),
    height * 0.6,
  );

  return (
    <g
      className="cursor-move"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        fill={darkMode ? "#27272a" : "#f4f4f5"}
        stroke={isSelected ? "#3b82f6" : darkMode ? "#52525b" : "#d4d4d8"}
        strokeWidth={isSelected ? 3 : 1}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={`M${x} ${y + COLOR_STRIP_HEIGHT}v${8 - COLOR_STRIP_HEIGHT}a8 8 0 0 1 8 -8h${width - 16}a8 8 0 0 1 8 8v${COLOR_STRIP_HEIGHT - 8}z`}
        fill={table.color}
      />
      <path
        d={rows}
        stroke="#9ca3af"
        strokeOpacity={0.6}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={x + width / 2}
        y={y + height / 2}
        fontSize={fontSize}
        fontWeight="bold"
        textAnchor="middle"
        dominantBaseline="central"
        fill={darkMode ? "#e4e4e7" : "#27272a"}
        stroke={darkMode ? "#27272a" : "#f4f4f5"}
        strokeWidth={fontSize / 5}
        paintOrder="stroke"
        className="select-none"
      >
        {name}
      </text>
    </g>
  );
}

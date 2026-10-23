import { noteWidth } from "../data/constants";
import { getTableHeight, getTableWidth } from "./utils";
import { getViewHeight, getViewWidth, resolveViewColumns } from "./views";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 5;
const PADDING = 10;

/**
 * The box spanning every table, view, area and note, grown by `padding` on
 * each side, or null when the diagram is empty.
 */
export function diagramBounds(
  { tables = [], views = [], areas = [], notes = [], relationships = [] },
  showComments = true,
  padding = 0,
) {
  const boxes = [
    ...tables.map((t) => ({
      x: t.x,
      y: t.y,
      w: getTableWidth(t),
      h: getTableHeight(t, showComments, relationships),
    })),
    ...views.map((v) => ({
      x: v.x,
      y: v.y,
      w: getViewWidth(v),
      h: getViewHeight(v, resolveViewColumns(v, tables), showComments),
    })),
    ...areas.map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height })),
    ...notes.map((n) => ({
      x: n.x,
      y: n.y,
      w: n.width ?? noteWidth,
      h: n.height,
    })),
  ].filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  if (!boxes.length) return null;

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + (b.w || 0)));
  const maxY = Math.max(...boxes.map((b) => b.y + (b.h || 0)));

  return {
    left: minX - padding,
    top: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * The pan/zoom that shows every table, view, area and note inside a canvas of
 * the given size, or null when there is nothing to fit.
 */
export function fitTransform(diagram, canvas, showComments = true) {
  if (!(canvas?.width > 0) || !(canvas?.height > 0)) return null;

  const bounds = diagramBounds(diagram, showComments);
  if (!bounds) return null;

  const scaleX = canvas.width / (bounds.width + PADDING);
  const scaleY = canvas.height / (bounds.height + PADDING);
  // Round down to a multiple of 0.05 so the zoom label stays readable.
  const scale = Math.floor(Math.min(scaleX, scaleY) * 20) / 20;

  return {
    zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale)),
    pan: {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    },
  };
}

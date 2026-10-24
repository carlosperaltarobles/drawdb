import { getTableHeight, getTableWidth } from "./utils";

export const LOCATE_MIN_ZOOM = 0.5;
export const LOCATE_ZOOM = 1;
export const FLASH_MS = 1500;

export function locateTransform(
  table,
  currentZoom = LOCATE_ZOOM,
  showComments = true,
  relationships = [],
) {
  const width = getTableWidth(table);
  const height = getTableHeight(table, showComments, relationships);

  return {
    pan: {
      x: table.x + width / 2,
      y: table.y + height / 2,
    },
    zoom: currentZoom < LOCATE_MIN_ZOOM ? LOCATE_ZOOM : currentZoom,
  };
}

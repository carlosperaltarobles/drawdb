// Browsers refuse to draw canvases beyond these sizes (Safari is the strictest).
const MAX_SIDE = 16384;
const MAX_AREA = 50_000_000;

/**
 * The pixel ratio for exporting an image of the given CSS size: `desired`
 * when it fits, otherwise the largest ratio the browser can still draw.
 */
export function exportPixelRatio(width, height, desired = 2) {
  if (!(width > 0) || !(height > 0)) return desired;
  return Math.min(
    desired,
    MAX_SIDE / width,
    MAX_SIDE / height,
    Math.sqrt(MAX_AREA / (width * height)),
  );
}

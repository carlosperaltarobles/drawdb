const SVG_NS = "http://www.w3.org/2000/svg";
const GRID_SELECTOR = 'rect[fill="url(#pattern-grid)"]';

/** The app's CSS as text, so the exported SVG looks like the canvas. */
function collectCss() {
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) css += rule.cssText + "\n";
    } catch {
      // Cross-origin sheets (web fonts) cannot be read; system fonts are used.
    }
  }
  return css;
}

/** Theme variables Semi UI defines on <body>, which an SVG image lacks. */
function bodyCustomProperties() {
  const style = getComputedStyle(document.body);
  let props = "";
  for (const name of style) {
    if (name.startsWith("--")) {
      props += `${name}:${style.getPropertyValue(name)};`;
    }
  }
  return props;
}

export function parseViewBox(svgElement) {
  const [left, top, width, height] = svgElement
    .getAttribute("viewBox")
    .split(" ")
    .map(Number);
  return { left, top, width, height };
}

/**
 * A standalone SVG document of the diagram drawn in `svgElement`, at
 * `width` x `height` CSS pixels. Styles are embedded instead of inlined per
 * node, which keeps exporting fast even with thousands of elements.
 *
 * `fitWindow` sizes the document to whatever opens it (a browser tab fits the
 * whole diagram and can zoom in) instead of its real, possibly huge, size.
 * `grid: false` leaves out the dotted background.
 */
export function buildDiagramSvg(
  svgElement,
  { width, height, background, grid = true, fitWindow = false },
) {
  const clone = svgElement.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", fitWindow ? "100%" : width);
  clone.setAttribute("height", fitWindow ? "100%" : height);
  clone.removeAttribute("class");
  clone.setAttribute(
    "style",
    `${bodyCustomProperties()}background:${background};font-family:${getComputedStyle(document.body).fontFamily};`,
  );
  // Icon fonts are not available inside an SVG image.
  clone.querySelectorAll("i").forEach((icon) => icon.remove());
  if (!grid) clone.querySelectorAll(GRID_SELECTOR).forEach((r) => r.remove());

  const view = parseViewBox(clone);
  const backdrop = document.createElementNS(SVG_NS, "rect");
  backdrop.setAttribute("x", view.left);
  backdrop.setAttribute("y", view.top);
  backdrop.setAttribute("width", view.width);
  backdrop.setAttribute("height", view.height);
  backdrop.setAttribute("fill", background);
  clone.prepend(backdrop);

  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = collectCss();
  clone.prepend(style);

  return new XMLSerializer().serializeToString(clone);
}

/**
 * Boxes (in diagram units) of everything drawn in the live `svgElement`
 * except the grid, so tiled exports can skip empty regions.
 */
export function contentBoxes(svgElement) {
  const boxes = [];
  for (const child of svgElement.children) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "style" || child.matches(GRID_SELECTOR)) {
      continue;
    }
    try {
      const box = child.getBBox();
      if (box.width > 0 || box.height > 0) {
        boxes.push({ x: box.x, y: box.y, w: box.width, h: box.height });
      }
    } catch {
      // Not rendered (e.g. display: none); nothing to export.
    }
  }
  return boxes;
}

export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadSvgImage(svg) {
  // A data URL (not a blob URL) keeps the canvas exportable in Chrome when
  // the SVG holds HTML (foreignObject).
  const image = new Image();
  image.decoding = "async";
  image.src = svgDataUrl(svg);
  await image.decode();
  return image;
}

function drawRegion(image, region, { pixelRatio, background, type, quality }) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(region.width * pixelRatio));
  canvas.height = Math.max(1, Math.floor(region.height * pixelRatio));
  const context = canvas.getContext("2d");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const data = canvas.toDataURL(type, quality);
  // Free the bitmap right away; large exports draw many of these.
  canvas.width = canvas.height = 0;
  return data;
}

/** Draws the SVG onto a canvas and returns it as a PNG or JPEG data URL. */
export async function rasterizeSvg(
  svg,
  { width, height, pixelRatio = 1, type = "image/png", quality, background },
) {
  const image = await loadSvgImage(svg);
  return drawRegion(
    image,
    { x: 0, y: 0, width, height },
    { pixelRatio, background, type, quality },
  );
}

/**
 * Tile rectangles (in CSS pixels of a `width` x `height` image) that contain
 * some of `boxes` (in diagram units of `viewBox`). Empty tiles are skipped.
 */
export function contentTiles({ width, height, viewBox, boxes, tileSize }) {
  const scale = width / viewBox.width;
  const tiles = [];
  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      const tile = {
        x,
        y,
        width: Math.min(tileSize, width - x),
        height: Math.min(tileSize, height - y),
      };
      const left = viewBox.left + x / scale;
      const top = viewBox.top + y / scale;
      const right = left + tile.width / scale;
      const bottom = top + tile.height / scale;
      const used = boxes.some(
        (b) =>
          b.x <= right &&
          b.x + b.w >= left &&
          b.y <= bottom &&
          b.y + b.h >= top,
      );
      if (used) tiles.push(tile);
    }
  }
  return tiles;
}

/**
 * Renders only the tiles of the SVG that have content, each at `pixelRatio`.
 * Unlike a single image, this stays sharp for diagrams of any size.
 */
export async function rasterizeSvgTiles(
  svg,
  {
    width,
    height,
    viewBox,
    boxes,
    pixelRatio = 2,
    tileSize = 2048,
    type = "image/jpeg",
    quality = 0.9,
    background,
    onProgress,
  },
) {
  const image = await loadSvgImage(svg);
  const tiles = contentTiles({ width, height, viewBox, boxes, tileSize });
  for (const [index, tile] of tiles.entries()) {
    onProgress?.(index, tiles.length);
    tile.data = drawRegion(image, tile, {
      pixelRatio,
      background,
      type,
      quality,
    });
    // Let the page breathe (spinners keep moving) between tiles.
    await new Promise((resolve) => setTimeout(resolve));
  }
  return tiles;
}

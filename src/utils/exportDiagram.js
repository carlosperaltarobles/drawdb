const SVG_NS = "http://www.w3.org/2000/svg";

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

/**
 * A standalone SVG document of the diagram drawn in `svgElement`, at
 * `width` x `height` CSS pixels. Styles are embedded instead of inlined per
 * node, which keeps exporting fast even with thousands of elements.
 */
export function buildDiagramSvg(svgElement, { width, height, background }) {
  const clone = svgElement.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);
  clone.removeAttribute("class");
  clone.setAttribute(
    "style",
    `${bodyCustomProperties()}background:${background};font-family:${getComputedStyle(document.body).fontFamily};`,
  );
  // Icon fonts are not available inside an SVG image.
  clone.querySelectorAll("i").forEach((icon) => icon.remove());

  const [left, top, viewWidth, viewHeight] = clone
    .getAttribute("viewBox")
    .split(" ")
    .map(Number);
  const backdrop = document.createElementNS(SVG_NS, "rect");
  backdrop.setAttribute("x", left);
  backdrop.setAttribute("y", top);
  backdrop.setAttribute("width", viewWidth);
  backdrop.setAttribute("height", viewHeight);
  backdrop.setAttribute("fill", background);
  clone.prepend(backdrop);

  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = collectCss();
  clone.prepend(style);

  return new XMLSerializer().serializeToString(clone);
}

export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Draws the SVG onto a canvas and returns it as a PNG or JPEG data URL. */
export async function rasterizeSvg(
  svg,
  { width, height, pixelRatio = 1, type = "image/png", quality, background },
) {
  // A data URL (not a blob URL) keeps the canvas exportable in Chrome when
  // the SVG holds HTML (foreignObject).
  const image = new Image();
  image.decoding = "async";
  image.src = svgDataUrl(svg);
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(width * pixelRatio);
  canvas.height = Math.floor(height * pixelRatio);
  const context = canvas.getContext("2d");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

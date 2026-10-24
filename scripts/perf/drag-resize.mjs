/**
 * Script de medición de fluidez de arrastre y redimensionado en diagramas grandes.
 *
 * Requisitos y uso:
 * 1. Autenticación: inicia sesión vía `POST /api/auth/login` leyendo `ADMIN_EMAIL`
 *    y `ADMIN_PASSWORD` desde `SERVER_ENV` (por defecto `/home/carlos/Proyectos/drawdb-server/.env`).
 * 2. Servidor a medir: medir siempre contra el build de producción (no `vite dev`):
 *      npx vite build && npx vite preview --port 4173
 *    (con `drawdb-server` activo en el puerto configurado por el proxy `/api`).
 * 3. Librerías de Chromium en WSL sin `sudo`:
 *    Si faltan `libnss3`, `libnspr4` o `libasound2t64` para el Chromium de Playwright:
 *      mkdir -p /tmp/pw-libs && cd /tmp/pw-libs
 *      apt-get download libnss3 libnspr4 libasound2t64
 *      for deb in *.deb; do dpkg-deb -x "$deb" /tmp/pw-libs; done
 *      LD_LIBRARY_PATH=/tmp/pw-libs/usr/lib/x86_64-linux-gnu node scripts/perf/drag-resize.mjs
 *
 * Variables de entorno opcionales:
 *   BASE        URL base (def. http://localhost:4173)
 *   PROJECT_ID  ID del proyecto (def. 01a164ff-0000-7000-8000-000000000200)
 *   SERVER_ENV  Ruta al .env del backend (def. /home/carlos/Proyectos/drawdb-server/.env)
 *   CHROME      Ejecutable de Chromium (def. ~/.cache/ms-playwright/chromium-1140/chrome-linux/chrome)
 *   RUNS        Corridas medidas por gesto tras calentamiento (def. 3)
 *   STEPS       Pasos de pointermove por gesto (def. 120)
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.BASE || "http://localhost:4173";
const PROJECT_ID =
  process.env.PROJECT_ID || "01a164ff-0000-7000-8000-000000000200";
const SERVER_ENV =
  process.env.SERVER_ENV || "/home/carlos/Proyectos/drawdb-server/.env";
const CHROME =
  process.env.CHROME ||
  path.join(
    process.env.HOME || "/home/carlos",
    ".cache/ms-playwright/chromium-1140/chrome-linux/chrome",
  );
const RUNS = Number(process.env.RUNS || 3);
const STEPS = Number(process.env.STEPS || 120);
const RECT_TOLERANCE_PX = 0.5;

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const entries = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const val = line
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    entries.push([key, val]);
  }
  return Object.fromEntries(entries);
}

function percentile(sortedValues, q) {
  if (sortedValues.length === 0) return 0;
  const pos = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(sortedValues.length * q)),
  );
  return sortedValues[pos];
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

async function assignTablePerfIds(page) {
  await page.evaluate(() => {
    const nodes = document.querySelectorAll("#diagram .cursor-move");
    nodes.forEach((node, index) => {
      const name =
        node.querySelector("text")?.textContent?.trim() ||
        node.querySelector(".font-bold .text-ellipsis")?.textContent?.trim() ||
        `table_${index}`;
      node.setAttribute("data-perf-id", `${name}#${index}`);
    });
  });
}

async function getCurrentZoomPercent(page) {
  return page.evaluate(() => {
    const matches = document.body.innerText.match(/\b(\d+)%/g);
    if (!matches || matches.length === 0) return null;
    return Number.parseInt(matches[matches.length - 1], 10);
  });
}

async function clearSelection(page) {
  const emptyPoint = await page.evaluate(() => {
    const svg = document.getElementById("diagram");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const candidates = [
      [rect.left + 18, rect.top + rect.height - 18],
      [rect.left + 18, rect.top + 55],
      [rect.right - 18, rect.top + rect.height - 18],
      [rect.right - 18, rect.top + 55],
    ];
    for (const [x, y] of candidates) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !hit.closest(".cursor-move")) {
        return { x, y };
      }
    }
    for (let x = rect.left + 20; x < rect.right - 20; x += 40) {
      for (let y = rect.top + 50; y < rect.bottom - 20; y += 40) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest(".cursor-move")) {
          return { x, y };
        }
      }
    }
    return { x: rect.left + 10, y: rect.top + 50 };
  });

  if (emptyPoint) {
    await page.mouse.click(emptyPoint.x, emptyPoint.y);
    await page.waitForTimeout(60);
  }
}

async function getVisibleTables(page) {
  await assignTablePerfIds(page);
  return page.evaluate(() => {
    const svg = document.getElementById("diagram");
    const cRect = svg.getBoundingClientRect();
    const centerX = cRect.left + cRect.width / 2;
    const centerY = cRect.top + cRect.height / 2;

    const items = [];
    for (const el of document.querySelectorAll("#diagram .cursor-move")) {
      const b = el.getBoundingClientRect();
      if (
        b.width <= 8 ||
        b.height <= 8 ||
        b.left < cRect.left + 20 ||
        b.right > cRect.right - 140 ||
        b.top < cRect.top + 48 ||
        b.bottom > cRect.bottom - 70
      ) {
        continue;
      }
      const clickX =
        b.left + Math.min(Math.max(8, b.width * 0.35), b.width - 4);
      const clickY = b.top + Math.min(10, b.height / 3);
      const hit = document.elementFromPoint(clickX, clickY);
      if (hit && hit.closest(".cursor-move") !== el) {
        continue;
      }
      items.push({
        perfId: el.getAttribute("data-perf-id"),
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        clickX,
        clickY,
        dist: Math.hypot(
          b.x + b.width / 2 - centerX,
          b.y + b.height / 2 - centerY,
        ),
      });
    }
    items.sort((a, b) => a.dist - b.dist);
    return items;
  });
}

async function getRectsByPerfIds(page, perfIds) {
  return page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const el = document.querySelector(
        `#diagram .cursor-move[data-perf-id="${CSS.escape(id)}"]`,
      );
      if (!el) {
        out[id] = null;
        continue;
      }
      const b = el.getBoundingClientRect();
      out[id] = { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    return out;
  }, perfIds);
}

async function undoAndVerifyRects(page, label, beforeRects) {
  await page.waitForTimeout(80);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(300);

  const perfIds = Object.keys(beforeRects);
  const afterRects = await getRectsByPerfIds(page, perfIds);

  for (const id of perfIds) {
    const before = beforeRects[id];
    const after = afterRects[id];
    if (!after) {
      console.error(
        `[ERROR] (${label}) La tabla "${id}" no se encontró en el DOM tras Ctrl+Z.`,
      );
      process.exit(1);
    }
    const dx = Math.abs(after.x - before.x);
    const dy = Math.abs(after.y - before.y);
    const dw = Math.abs(after.width - before.width);
    const dh = Math.abs(after.height - before.height);
    if (
      dx > RECT_TOLERANCE_PX ||
      dy > RECT_TOLERANCE_PX ||
      dw > RECT_TOLERANCE_PX ||
      dh > RECT_TOLERANCE_PX
    ) {
      console.error(
        `[ERROR] (${label}) La tabla "${id}" no volvió a su posición/tamaño original tras Ctrl+Z ` +
          `(tolerancia ${RECT_TOLERANCE_PX} px): ` +
          `antes=${JSON.stringify(before)} después=${JSON.stringify(after)} ` +
          `deltas={dx:${dx.toFixed(2)}, dy:${dy.toFixed(2)}, dw:${dw.toFixed(2)}, dh:${dh.toFixed(2)}}`,
      );
      process.exit(1);
    }
  }
}

async function measureGesture(page, action) {
  await page.evaluate(() => {
    window.__perfFrames = [];
    window.__perfLongTasks = [];
    window.__perfRunning = true;
    let last = performance.now();
    const tick = (now) => {
      window.__perfFrames.push(now - last);
      last = now;
      if (window.__perfRunning) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
    if (typeof PerformanceObserver !== "undefined") {
      try {
        window.__perfObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__perfLongTasks.push(entry.duration);
          }
        });
        window.__perfObserver.observe({ type: "longtask", buffered: false });
      } catch {
        // Ignore if unsupported
      }
    }
  });

  await action();

  return page.evaluate(() => {
    window.__perfRunning = false;
    if (window.__perfObserver) {
      window.__perfObserver.disconnect();
    }
    return {
      frames: window.__perfFrames.slice(1),
      longTasks: window.__perfLongTasks,
    };
  });
}

function summarizeRuns(runResults) {
  const medians = [];
  const p95s = [];
  const maxLongs = [];

  for (const r of runResults) {
    const sorted = [...r.frames].sort((a, b) => a - b);
    medians.push(percentile(sorted, 0.5));
    p95s.push(percentile(sorted, 0.95));
    maxLongs.push(r.longTasks.length > 0 ? Math.max(...r.longTasks) : 0);
  }

  const medFrame = median(medians);
  const p95Frame = median(p95s);
  const maxLongTask = median(maxLongs);
  const pass = medFrame <= 20 && p95Frame <= 50 && maxLongTask <= 100;

  return {
    medFrame,
    p95Frame,
    maxLongTask,
    status: pass ? "PASS" : "FAIL",
  };
}

async function runSingleTableDrag(page, zoomLabel) {
  await clearSelection(page);
  const visible = await getVisibleTables(page);
  if (visible.length === 0) {
    throw new Error(`No hay tablas visibles en el lienzo a zoom ${zoomLabel}.`);
  }
  const target = visible[0];
  const beforeRects = await getRectsByPerfIds(page, [target.perfId]);

  await page.mouse.move(target.clickX, target.clickY);
  const result = await measureGesture(page, async () => {
    await page.mouse.down();
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(
        target.clickX + i,
        target.clickY + Math.round(i / 2),
      );
    }
    await page.mouse.up();
  });

  await undoAndVerifyRects(
    page,
    `arrastre 1 tabla @ ${zoomLabel}`,
    beforeRects,
  );
  return result;
}

async function runMultiTableDrag(page, zoomLabel, logCount = false) {
  await clearSelection(page);
  const visible = await getVisibleTables(page);
  const selected = visible.slice(0, 20);
  if (selected.length === 0) {
    throw new Error(
      `No hay tablas visibles para selección múltiple a zoom ${zoomLabel}.`,
    );
  }
  if (logCount && selected.length < 20) {
    console.log(
      `  [nota] Solo hay ${selected.length} tablas visibles a zoom ${zoomLabel}; usando ${selected.length}.`,
    );
  }

  const perfIds = selected.map((t) => t.perfId);
  const beforeRects = await getRectsByPerfIds(page, perfIds);

  await page.keyboard.down("Control");
  for (const t of selected) {
    await page.mouse.click(t.clickX, t.clickY);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(50);

  const lead = selected[0];
  await page.mouse.move(lead.clickX, lead.clickY);
  const result = await measureGesture(page, async () => {
    await page.mouse.down();
    for (let i = 1; i <= STEPS; i++) {
      await page.mouse.move(lead.clickX + i, lead.clickY + Math.round(i / 2));
    }
    await page.mouse.up();
  });

  await undoAndVerifyRects(
    page,
    `arrastre ${selected.length} tablas @ ${zoomLabel}`,
    beforeRects,
  );
  return { ...result, count: selected.length };
}

async function runTableResize(page, zoomLabel) {
  await clearSelection(page);
  const visible = await getVisibleTables(page);
  if (visible.length === 0) {
    throw new Error(
      `No hay tablas visibles para redimensionar a zoom ${zoomLabel}.`,
    );
  }
  const target = visible[0];
  const beforeRects = await getRectsByPerfIds(page, [target.perfId]);

  await page.mouse.move(target.clickX, target.clickY);
  await page.waitForTimeout(100);

  const handlePoint = await page.evaluate((perfId) => {
    const el = document.querySelector(
      `#diagram .cursor-move[data-perf-id="${CSS.escape(perfId)}"]`,
    );
    if (!el) return null;
    const rightGroup = el.nextElementSibling?.nextElementSibling;
    const handleRect = rightGroup?.querySelector('rect[style*="ew-resize"]');
    if (handleRect) {
      const hb = handleRect.getBoundingClientRect();
      if (hb.width > 0 && hb.height > 0) {
        return { x: hb.left + hb.width / 2, y: hb.top + hb.height / 2 };
      }
    }
    const b = el.getBoundingClientRect();
    return { x: b.right - 1, y: b.top + b.height / 2 };
  }, target.perfId);

  const forwardSteps = Math.ceil((STEPS * 2) / 3);
  await page.mouse.move(handlePoint.x, handlePoint.y);
  const result = await measureGesture(page, async () => {
    await page.mouse.down();
    for (let i = 1; i <= STEPS; i++) {
      const offset = i <= forwardSteps ? i : forwardSteps - (i - forwardSteps);
      await page.mouse.move(handlePoint.x + offset, handlePoint.y);
    }
    await page.mouse.up();
  });

  await undoAndVerifyRects(
    page,
    `redimensionado 1 tabla @ ${zoomLabel}`,
    beforeRects,
  );
  return result;
}
async function zoomToDetailedCluster(page) {
  await clearSelection(page);
  const clusterTarget = await page.evaluate(() => {
    const svg = document.getElementById("diagram");
    const cRect = svg.getBoundingClientRect();
    const tables = [...document.querySelectorAll("#diagram .cursor-move")].map(
      (el) => {
        const b = el.getBoundingClientRect();
        return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
      },
    );
    let best = {
      count: -1,
      cx: cRect.left + cRect.width / 2,
      cy: cRect.top + cRect.height / 2,
    };
    for (const t of tables) {
      const count = tables.filter(
        (o) => Math.abs(o.cx - t.cx) < 160 && Math.abs(o.cy - t.cy) < 100,
      ).length;
      if (count > best.count) {
        best = { count, cx: t.cx, cy: t.cy };
      }
    }
    return {
      dx: best.cx - (cRect.left + cRect.width / 2),
      dy: best.cy - (cRect.top + cRect.height / 2),
      centerX: cRect.left + cRect.width / 2,
      centerY: cRect.top + cRect.height / 2,
    };
  });

  await page.mouse.move(clusterTarget.centerX, clusterTarget.centerY);
  await page.mouse.wheel(clusterTarget.dx, clusterTarget.dy);
  await page.waitForTimeout(300);

  for (let step = 0; step < 60; step++) {
    const zoomPct = await getCurrentZoomPercent(page);
    const hasForeignObjects = await page.evaluate(
      () => document.querySelectorAll("#diagram foreignObject").length > 0,
    );
    if (zoomPct !== null && zoomPct >= 35 && hasForeignObjects) {
      break;
    }
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(500);
}

function printSummaryLine(zoomLabel, gestureLabel, summary) {
  if (summary === "n/a") {
    console.log(`[${zoomLabel}] ${gestureLabel}: n/a`);
    return;
  }
  console.log(
    `[${zoomLabel}] ${gestureLabel}: ` +
      `mediana=${summary.medFrame.toFixed(1)} ms (≤20), ` +
      `p95=${summary.p95Frame.toFixed(1)} ms (≤50), ` +
      `longtask_max=${summary.maxLongTask.toFixed(1)} ms (≤100) ` +
      `=> ${summary.status}`,
  );
}

async function main() {
  const env = parseEnvFile(SERVER_ENV);
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error(
      `ADMIN_EMAIL / ADMIN_PASSWORD no encontrados en ${SERVER_ENV}`,
    );
  }

  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 900 },
    });

    const loginRes = await page.request.post(`${BASE}/api/auth/login`, {
      data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });
    if (!loginRes.ok()) {
      throw new Error(
        `Error en POST /api/auth/login: HTTP ${loginRes.status()}`,
      );
    }

    await page.goto(`${BASE}/projects/${PROJECT_ID}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("#diagram .cursor-move", { timeout: 30000 });
    await page.waitForTimeout(2500);

    const initialZoom = (await getCurrentZoomPercent(page)) ?? 5;
    const lowZoomLabel = `zoom ${initialZoom}%`;

    // --- Zoom 5% (vista simplificada) ---
    await runSingleTableDrag(page, lowZoomLabel);
    const lowDrag1Runs = [];
    for (let i = 0; i < RUNS; i++) {
      lowDrag1Runs.push(await runSingleTableDrag(page, lowZoomLabel));
    }
    printSummaryLine(
      lowZoomLabel,
      `arrastre 1 tabla (${STEPS} pasos)`,
      summarizeRuns(lowDrag1Runs),
    );

    const warmupLowMulti = await runMultiTableDrag(page, lowZoomLabel, true);
    const lowDrag20Runs = [];
    for (let i = 0; i < RUNS; i++) {
      lowDrag20Runs.push(await runMultiTableDrag(page, lowZoomLabel, false));
    }
    printSummaryLine(
      lowZoomLabel,
      `arrastre ${warmupLowMulti.count} tablas (${STEPS} pasos)`,
      summarizeRuns(lowDrag20Runs),
    );

    printSummaryLine(
      lowZoomLabel,
      `redimensionado 1 tabla (${STEPS} pasos)`,
      "n/a",
    );

    // --- Zoom >= 35% (vista detallada con Ctrl+rueda) ---
    await zoomToDetailedCluster(page);
    const highZoom = (await getCurrentZoomPercent(page)) ?? 35;
    const highZoomLabel = `zoom ${highZoom}%`;

    await runSingleTableDrag(page, highZoomLabel);
    const highDrag1Runs = [];
    for (let i = 0; i < RUNS; i++) {
      highDrag1Runs.push(await runSingleTableDrag(page, highZoomLabel));
    }
    printSummaryLine(
      highZoomLabel,
      `arrastre 1 tabla (${STEPS} pasos)`,
      summarizeRuns(highDrag1Runs),
    );

    const warmupHighMulti = await runMultiTableDrag(page, highZoomLabel, true);
    const highDrag20Runs = [];
    for (let i = 0; i < RUNS; i++) {
      highDrag20Runs.push(await runMultiTableDrag(page, highZoomLabel, false));
    }
    printSummaryLine(
      highZoomLabel,
      `arrastre ${warmupHighMulti.count} tablas (${STEPS} pasos)`,
      summarizeRuns(highDrag20Runs),
    );

    await runTableResize(page, highZoomLabel);
    const highResizeRuns = [];
    for (let i = 0; i < RUNS; i++) {
      highResizeRuns.push(await runTableResize(page, highZoomLabel));
    }
    printSummaryLine(
      highZoomLabel,
      `redimensionado 1 tabla (${STEPS} pasos)`,
      summarizeRuns(highResizeRuns),
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  SYNTHETIC_SIZES,
  createSyntheticDiagram,
  createSyntheticProposalFixture,
} from "../../src/ai/syntheticFixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const CHROME =
  process.env.CHROME ||
  path.join(
    process.env.HOME || "/home/carlos",
    ".cache/ms-playwright/chromium-1140/chrome-linux/chrome",
  );
const RUNS = Number(process.env.RUNS || 5);
const STEPS = Number(process.env.STEPS || 60);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(sorted.length * q)),
  );
  return sorted[idx];
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export function startDistServer(distDir = DIST_DIR) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
      let filePath = path.join(distDir, decodeURIComponent(reqUrl.pathname));
      if (
        !filePath.startsWith(distDir) ||
        !fs.existsSync(filePath) ||
        fs.statSync(filePath).isDirectory()
      ) {
        filePath = path.join(distDir, "index.html");
      }
      try {
        const ext = path.extname(filePath);
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
          "Cache-Control": "no-cache",
        });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

export function runDeterministicNodeBaseline() {
  const results = [];
  for (const size of SYNTHETIC_SIZES) {
    const warmDoc = createSyntheticDiagram(size);
    createSyntheticProposalFixture(warmDoc, {
      changeCount: 60,
    });

    const genSamples = [];
    const proposalSamples = [];
    const serializeSamples = [];

    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      const doc = createSyntheticDiagram(size);
      const t1 = performance.now();
      genSamples.push(t1 - t0);

      const t2 = performance.now();
      const fixture = createSyntheticProposalFixture(doc, { changeCount: 60 });
      const t3 = performance.now();
      proposalSamples.push(t3 - t2);

      const t4 = performance.now();
      JSON.stringify(fixture.after);
      const t5 = performance.now();
      serializeSamples.push(t5 - t4);
    }

    results.push({
      tables: size,
      runs: RUNS,
      generateMedianMs: Number(median(genSamples).toFixed(2)),
      proposalMedianMs: Number(median(proposalSamples).toFixed(2)),
      proposalP95Ms: Number(percentile(proposalSamples, 0.95).toFixed(2)),
      serializeMedianMs: Number(median(serializeSamples).toFixed(2)),
      serializeP95Ms: Number(percentile(serializeSamples, 0.95).toFixed(2)),
    });
  }
  return results;
}


async function measureBrowserSize(browser, baseUrl, size) {
  const diagramId = `synthetic-${size}`;
  const doc = createSyntheticDiagram(size);
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
  });

  try {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "u-synthetic-baseline",
            email: "synthetic@drawdb.local",
            name: "Synthetic Runner",
            role: "editor",
          },
        }),
      }),
    );

    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });

    await page.evaluate(
      async ({ seededDiagramId, seededDoc }) => {
        await new Promise((resolve, reject) => {
          const req = indexedDB.open("drawDB");
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("diagrams")) {
              db.createObjectStore("diagrams", {
                keyPath: "id",
                autoIncrement: true,
              });
            }
          };
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("diagrams", "readwrite");
            const store = tx.objectStore("diagrams");
            store.clear();
            store.put({
              id: 1,
              diagramId: seededDiagramId,
              name: `Synthetic ${seededDoc.tables.length}`,
              lastModified: new Date(),
              ...seededDoc,
              references: seededDoc.relationships,
              pan: { x: 0, y: 0 },
              zoom: 0.2,
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      { seededDiagramId: diagramId, seededDoc: doc },
    );

    const navStart = performance.now();
    await page.goto(`${baseUrl}/editor/diagrams/${diagramId}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("#diagram .cursor-move", { timeout: 30000 });
    const loadMs = performance.now() - navStart;

    const runDragGesture = async () => {
      const box = await page.evaluate(() => {
        const el = document.querySelector("#diagram .cursor-move");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: r.left + r.width / 2,
          y: r.top + Math.min(20, r.height / 2),
        };
      });
      if (!box) return { p50: 0, p95: 0, maxDelta: 0 };

      await page.evaluate(() => {
        window.__perfFrames = [];
        let last = performance.now();
        window.__perfActive = true;
        const tick = (now) => {
          window.__perfFrames.push(now - last);
          last = now;
          if (window.__perfActive) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });

      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      for (let s = 1; s <= STEPS; s++) {
        await page.mouse.move(box.x + (s % 2 === 0 ? 4 : -4), box.y + 2);
      }
      await page.mouse.up();

      const frames = await page.evaluate(() => {
        window.__perfActive = false;
        return window.__perfFrames || [];
      });
      return {
        p50: Number(median(frames).toFixed(2)),
        p95: Number(percentile(frames, 0.95).toFixed(2)),
        maxDelta: Number(Math.max(0, ...frames).toFixed(2)),
      };
    };

    await runDragGesture();
    const dragRuns = [];
    for (let i = 0; i < RUNS; i++) {
      dragRuns.push(await runDragGesture());
    }

    return {
      tables: size,
      runs: RUNS,
      loadMs: Number(loadMs.toFixed(1)),
      dragP50Ms: Number(median(dragRuns.map((r) => r.p50)).toFixed(2)),
      dragP95Ms: Number(median(dragRuns.map((r) => r.p95)).toFixed(2)),
      dragMaxMs: Number(Math.max(...dragRuns.map((r) => r.maxDelta)).toFixed(2)),
    };
  } finally {
    await page.close();
  }
}

async function main() {
  const nodeBaseline = runDeterministicNodeBaseline();
  console.log("=== Deterministic Synthetic Node Baseline (5 warm runs) ===");
  console.table(nodeBaseline);

  if (!fs.existsSync(DIST_DIR)) {
    console.error(
      `dist/ not found at ${DIST_DIR}. Run 'npm run build' before running browser harness.`,
    );
    process.exitCode = 1;
    return;
  }

  let serverHandle = null;
  let browser = null;
  try {
    const baseUrl =
      process.env.BASE ||
      (await (async () => {
        serverHandle = await startDistServer(DIST_DIR);
        return serverHandle.baseUrl;
      })());

    browser = await chromium.launch({ executablePath: CHROME });
    const browserResults = [];
    for (const size of SYNTHETIC_SIZES) {
      browserResults.push(await measureBrowserSize(browser, baseUrl, size));
    }
    console.log("=== Browser Synthetic Baseline (5 warm runs) ===");
    console.table(browserResults);
  } catch (err) {
    console.error("BROWSER_HARNESS_BLOCKED:", err.message || String(err));
    process.exitCode = process.env.ALLOW_BROWSER_BLOCKED === "1" ? 0 : 2;
  } finally {
    if (browser) await browser.close();
    if (serverHandle) await serverHandle.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

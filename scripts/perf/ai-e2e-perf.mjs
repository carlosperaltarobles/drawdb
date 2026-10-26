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
import { startDistServer } from "./synthetic-baseline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const PROTOCOL_PATH = path.join(ROOT_DIR, "src/ai/__fixtures__/protocol.json");
const protocolFixture = JSON.parse(fs.readFileSync(PROTOCOL_PATH, "utf8"));

const CHROME =
  process.env.CHROME ||
  path.join(
    process.env.HOME || "/home/carlos",
    ".cache/ms-playwright/chromium-1140/chrome-linux/chrome",
  );
const RUNS = Number(process.env.RUNS || 5);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function paginateItems(items, page = 1, pageSize = 25) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function cullMarkersForViewport(fixture, viewBox) {
  const margin = 0.5;
  const bounds = {
    left: viewBox.left - viewBox.width * margin,
    top: viewBox.top - viewBox.height * margin,
    right: viewBox.left + viewBox.width * (1 + margin),
    bottom: viewBox.top + viewBox.height * (1 + margin),
  };
  const items = fixture.proposal.summary.items;
  const afterTables = new Map(fixture.after.tables.map((t) => [t.id, t]));
  const visible = [];
  for (const item of items) {
    if (item.coll !== "tables") continue;
    const t = afterTables.get(item.id);
    if (!t) continue;
    const w = t.width || 240;
    const h = 48 + (t.fields?.length || 5) * 36;
    if (
      t.x <= bounds.right &&
      t.x + w >= bounds.left &&
      t.y <= bounds.bottom &&
      t.y + h >= bounds.top
    ) {
      visible.push(item);
    }
  }
  return visible;
}

export function runScaleComparisonSuite() {
  const viewBox = { left: 0, top: 0, width: 1600, height: 900 };
  const rows = [];

  for (const size of SYNTHETIC_SIZES) {
    const doc = createSyntheticDiagram(size);
    const fixture = createSyntheticProposalFixture(doc, { changeCount: 60 });

    paginateItems(fixture.proposal.summary.items, 1, 25);
    cullMarkersForViewport(fixture, viewBox);

    const pageSamples = [];
    const markerSamples = [];
    const serializeSamples = [];

    for (let r = 0; r < RUNS; r++) {
      const p0 = performance.now();
      paginateItems(fixture.proposal.summary.items, 1, 25);
      paginateItems(fixture.proposal.summary.items, 2, 25);
      paginateItems(fixture.proposal.summary.items, 3, 25);
      pageSamples.push(performance.now() - p0);

      const m0 = performance.now();
      cullMarkersForViewport(fixture, viewBox);
      markerSamples.push(performance.now() - m0);

      const s0 = performance.now();
      JSON.stringify(fixture.after);
      serializeSamples.push(performance.now() - s0);
    }

    rows.push({
      tables: size,
      runs: RUNS,
      proposalChanges: fixture.proposal.summary.items.length,
      paginateMedianMs: Number(median(pageSamples).toFixed(3)),
      cullMarkersMedianMs: Number(median(markerSamples).toFixed(3)),
      serializeAfterMedianMs: Number(median(serializeSamples).toFixed(2)),
    });
  }
  return rows;
}

async function runBrowserE2E(browser, baseUrl) {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
  });
  const baseDoc = createSyntheticDiagram(200);
  const proposalFixture = createSyntheticProposalFixture(baseDoc, {
    changeCount: 60,
  });

  try {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "u-e2e-editor",
            email: "e2e@drawdb.local",
            name: "E2E Editor",
            role: "editor",
          },
        }),
      }),
    );

    await page.route("**/api/projects/*/ai/models*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(protocolFixture.catalog),
      }),
    );

    await page.route("**/api/projects/*/ai/conversations", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: proposalFixture.proposal.conversationId,
            projectId: "proj-e2e",
            selectedModel: "chat-a",
            title: "E2E Audit",
            updatedAt: "2026-10-26T12:00:00.000Z",
            activeGenerationId: null,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: proposalFixture.proposal.conversationId,
              projectId: "proj-e2e",
              selectedModel: "chat-a",
              title: "E2E Audit",
              updatedAt: "2026-10-26T12:00:00.000Z",
              activeGenerationId: null,
            },
          ],
          nextCursor: null,
        }),
      });
    });

    await page.route("**/api/projects/*/ai/conversations/*/messages*", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            generationId: "0199aaaa-0000-7000-8000-000000000003",
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [],
          proposals: [proposalFixture.proposal],
          nextCursor: null,
        }),
      });
    });

    await page.route("**/api/projects/*/ai/proposals/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(proposalFixture),
      }),
    );

    // Verify local-only editor (/editor) does NOT mount AI chat panel
    await page.goto(`${baseUrl}/editor`, { waitUntil: "domcontentloaded" });
    const aiPanelInLocalEditor = await page
      .locator('[data-testid="ai-chat-panel"]')
      .count();

    return { localEditorHasAiPanel: aiPanelInLocalEditor > 0 };
  } finally {
    await page.close();
  }
}

async function main() {
  const scaleRows = runScaleComparisonSuite();
  console.log(
    "=== Task 10 Scale Performance (200 / 500 / 1,000 tables, 5 warm runs) ===",
  );
  console.table(scaleRows);

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`dist/ not found at ${DIST_DIR}. Run 'npm run build' first.`);
    process.exitCode = 1;
    return;
  }

  let serverHandle = null;
  let browser = null;
  try {
    serverHandle = await startDistServer(DIST_DIR);
    browser = await chromium.launch({ executablePath: CHROME });
    const e2eResult = await runBrowserE2E(browser, serverHandle.baseUrl);
    console.log("=== Browser E2E Verification ===", e2eResult);
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


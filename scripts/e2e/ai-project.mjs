import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserE2E } from "../perf/ai-e2e-perf.mjs";
import { startDistServer } from "../perf/synthetic-baseline.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const CHROME =
  process.env.CHROME ||
  path.join(
    process.env.HOME || "/home/carlos",
    ".cache/ms-playwright/chromium-1140/chrome-linux/chrome",
  );

async function main() {
  const baseUrl = process.env.BASE_URL;
  let serverHandle = null;
  let browser = null;
  try {
    if (!baseUrl) {
      serverHandle = await startDistServer(DIST_DIR);
    }
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox"],
    });
    const result = await runBrowserE2E(
      browser,
      baseUrl || serverHandle.baseUrl,
    );
    console.log(JSON.stringify({ ok: true, result }));
  } finally {
    if (browser) await browser.close();
    if (serverHandle) await serverHandle.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

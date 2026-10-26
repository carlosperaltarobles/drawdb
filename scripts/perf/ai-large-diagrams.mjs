import { runScaleComparisonSuite } from "./ai-e2e-perf.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = runScaleComparisonSuite();
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2));
}

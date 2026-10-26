import { describe, expect, it } from "vitest";
import {
  SYNTHETIC_SIZES,
  createSyntheticDiagram,
  createSyntheticProposalFixture,
} from "./syntheticFixtures";
import { applyOps, diffDoc } from "../collab/ops";
import { cullBounds, cullElements } from "../utils/culling";
import { getTableHeight, getTableWidth } from "../utils/utils";

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

describe("syntheticFixtures", () => {
  it("exposes the required 200, 500, and 1000 table scale sizes", () => {
    expect(SYNTHETIC_SIZES).toEqual([200, 500, 1000]);
  });

  it("generates deterministic diagrams for 200, 500, and 1000 tables with fields, relationships, areas, and notes", () => {
    const first200 = createSyntheticDiagram(200);
    const second200 = createSyntheticDiagram(200);
    expect(first200).toEqual(second200);

    for (const size of SYNTHETIC_SIZES) {
      const doc = createSyntheticDiagram(size);
      expect(doc.database).toBe("postgresql");
      expect(typeof doc.sqlHeader).toBe("string");
      expect(doc.tables).toHaveLength(size);
      expect(doc.relationships.length).toBeGreaterThanOrEqual(size - 1);
      expect(doc.areas.length).toBeGreaterThanOrEqual(Math.ceil(size / 25));
      expect(doc.notes.length).toBeGreaterThanOrEqual(Math.ceil(size / 50));
      expect(Array.isArray(doc.views)).toBe(true);
      expect(Array.isArray(doc.enums)).toBe(true);
      expect(Array.isArray(doc.types)).toBe(true);

      const sampleTable = doc.tables[0];
      expect(sampleTable.fields.length).toBeGreaterThanOrEqual(5);
      expect(Number.isFinite(sampleTable.x)).toBe(true);
      expect(Number.isFinite(sampleTable.y)).toBe(true);
    }
  });

  it("generates a valid proposal fixture with >50 change summary items and applicable ops", () => {
    const baseDoc = createSyntheticDiagram(200);
    const fixture = createSyntheticProposalFixture(baseDoc, {
      changeCount: 60,
    });

    expect(fixture.proposal.status).toBe("pending");
    expect(fixture.proposal.summary.items.length).toBeGreaterThanOrEqual(60);
    expect(
      fixture.proposal.summary.counts.added +
        fixture.proposal.summary.counts.modified +
        fixture.proposal.summary.counts.removed,
    ).toBe(fixture.proposal.summary.items.length);

    const applied = applyOps(fixture.before, fixture.ops);
    expect(applied.ok).toBe(true);
    expect(diffDoc(applied.doc, fixture.after)).toEqual([]);
  });

  it("measures 5 warm runs of unchanged canvas culling, applyOps, and diffDoc for 200, 500, and 1000 tables", () => {
    const bounds = cullBounds({ left: 0, top: 0, width: 1600, height: 900 });
    const rows = [];

    for (const size of SYNTHETIC_SIZES) {
      const doc = createSyntheticDiagram(size);
      const fixture = createSyntheticProposalFixture(doc, { changeCount: 60 });
      const boxes = new Map(
        doc.tables.map((t) => [
          t.id,
          {
            x: t.x,
            y: t.y,
            w: getTableWidth(t),
            h: getTableHeight(t, false, doc.relationships),
          },
        ]),
      );

      cullElements({
        tables: doc.tables,
        relationships: doc.relationships,
        boxes,
        bounds,
      });
      applyOps(fixture.before, fixture.ops);
      diffDoc(fixture.before, fixture.after);

      const cullSamples = [];
      const applySamples = [];
      const diffSamples = [];

      for (let i = 0; i < 5; i++) {
        const c0 = performance.now();
        const culled = cullElements({
          tables: doc.tables,
          relationships: doc.relationships,
          boxes,
          bounds,
        });
        cullSamples.push(performance.now() - c0);
        expect(culled.tables.length).toBeGreaterThan(0);
        expect(culled.tables.length).toBeLessThan(size);

        const a0 = performance.now();
        const applied = applyOps(fixture.before, fixture.ops);
        applySamples.push(performance.now() - a0);
        expect(applied.ok).toBe(true);

        const d0 = performance.now();
        const ops = diffDoc(fixture.before, fixture.after);
        diffSamples.push(performance.now() - d0);
        expect(ops.length).toBe(fixture.ops.length);
      }

      rows.push({
        tables: size,
        cullMedianMs: Number(median(cullSamples).toFixed(3)),
        applyOpsMedianMs: Number(median(applySamples).toFixed(3)),
        diffDocMedianMs: Number(median(diffSamples).toFixed(3)),
      });
    }

    for (const row of rows) {
      expect(row.cullMedianMs).toBeLessThan(25);
      expect(row.applyOpsMedianMs).toBeLessThan(100);
    }
  });
});

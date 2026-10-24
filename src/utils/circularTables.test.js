import { describe, expect, it } from "vitest";
import { findCircularTableIds } from "./circularTables";

const t = (id) => ({ id, name: String(id) });
const r = (startTableId, endTableId) => ({ startTableId, endTableId });

describe("findCircularTableIds", () => {
  it("returns empty array when there are no cycles", () => {
    const tables = [t("A"), t("B"), t("C")];
    const relationships = [r("A", "B"), r("B", "C")];
    expect(findCircularTableIds(tables, relationships)).toEqual([]);
  });

  it("detects a simple two-table cycle", () => {
    const tables = [t("A"), t("B")];
    const relationships = [r("A", "B"), r("B", "A")];
    expect(findCircularTableIds(tables, relationships)).toEqual(["A"]);
  });

  it("detects a long cycle", () => {
    const tables = [t("A"), t("B"), t("C"), t("D")];
    const relationships = [r("A", "B"), r("B", "C"), r("C", "D"), r("D", "A")];
    expect(findCircularTableIds(tables, relationships)).toEqual(["A"]);
  });

  it("does not repeat tables when multiple cycles share tables", () => {
    const tables = [t("A"), t("B"), t("C")];
    const relationships = [
      r("A", "B"),
      r("B", "A"),
      r("B", "C"),
      r("C", "B"),
      r("C", "A"),
    ];
    expect(findCircularTableIds(tables, relationships)).toEqual(["A", "B"]);
  });

  it("ignores self-relationships", () => {
    const tables = [t("A")];
    const relationships = [r("A", "A")];
    expect(findCircularTableIds(tables, relationships)).toEqual([]);
  });

  it("ignores dangling table ids without throwing", () => {
    const tables = [t("A")];
    const relationships = [r("A", "X"), r("X", "A")];
    expect(findCircularTableIds(tables, relationships)).toEqual([]);
  });

  it("is deterministic across repeated calls", () => {
    const tables = [t("A"), t("B"), t("C"), t("D")];
    const relationships = [
      r("A", "B"),
      r("B", "C"),
      r("C", "A"),
      r("C", "D"),
      r("D", "B"),
    ];
    const first = findCircularTableIds(tables, relationships);
    const second = findCircularTableIds(tables, relationships);
    expect(first).toEqual(second);
  });

  it("handles a 5000-table chain cycle without stack overflow", () => {
    const count = 5000;
    const tables = Array.from({ length: count }, (_, i) => t(`t${i}`));
    const relationships = Array.from({ length: count }, (_, i) =>
      r(`t${i}`, `t${(i + 1) % count}`),
    );
    expect(findCircularTableIds(tables, relationships)).toEqual(["t0"]);
  });

  it("processes a seeded 200-table 250-relationship graph in under 50ms", () => {
    let seed = 123456789;
    const nextInt = (max) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % max;
    };

    const tables = Array.from({ length: 200 }, (_, i) => t(`t${i}`));
    const relationships = Array.from({ length: 250 }, () =>
      r(`t${nextInt(200)}`, `t${nextInt(200)}`),
    );

    const start = performance.now();
    const first = findCircularTableIds(tables, relationships);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(findCircularTableIds(tables, relationships)).toEqual(first);
  });
});

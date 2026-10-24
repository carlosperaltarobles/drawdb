import { describe, expect, it } from "vitest";
import {
  DIMMED_OPACITY,
  FOCUS_DEPTHS,
  relatedSubgraph,
  relatedTableIds,
} from "./relatedTables";

const r = (a, b) => ({ id: `${a}${b}`, startTableId: a, endTableId: b });

describe("relatedTables", () => {
  it("exports FOCUS_DEPTHS and DIMMED_OPACITY", () => {
    expect(FOCUS_DEPTHS).toEqual([1, 2, 3, Infinity]);
    expect(DIMMED_OPACITY).toBe(0.2);
  });

  it("depth 1 includes both directions", () => {
    const rels = [r("A", "B"), r("C", "A"), r("B", "D")];
    expect(relatedTableIds(rels, "A", 1)).toEqual(new Set(["A", "B", "C"]));
  });

  it("depth 2 reaches two hops", () => {
    const rels = [r("A", "B"), r("C", "A"), r("B", "D")];
    expect(relatedTableIds(rels, "A", 2)).toEqual(
      new Set(["A", "B", "C", "D"]),
    );
  });

  it("Infinity returns the whole connected component", () => {
    const rels = [r("A", "B"), r("B", "C"), r("C", "D"), r("D", "E")];
    const result = relatedTableIds(rels, "A", Infinity);
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
    expect(result.has("X")).toBe(false);
  });

  it("cycles and self references terminate", () => {
    const rels = [r("A", "B"), r("B", "A"), r("A", "A")];
    expect(relatedTableIds(rels, "A", Infinity)).toEqual(new Set(["A", "B"]));
  });

  it("table without relationships returns only itself", () => {
    expect(relatedTableIds([], "A", 1)).toEqual(new Set(["A"]));
  });

  it("relatedSubgraph drops orphan relationships and missing tables", () => {
    const tables = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ];
    const rels = [r("A", "B"), r("A", "Z")];
    const subgraph = relatedSubgraph(tables, rels, "A", 1);
    expect(subgraph.tables).toEqual(tables);
    expect(subgraph.relationships).toEqual([r("A", "B")]);
  });
});

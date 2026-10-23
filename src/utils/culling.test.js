import { describe, expect, it } from "vitest";
import { cullBounds, cullElements } from "./culling";

const viewBox = { left: 0, top: 0, width: 1000, height: 1000 };
const box = (x, y) => ({ x, y, w: 100, h: 100 });

const tables = [{ id: "near" }, { id: "far" }, { id: "farther" }];
const boxes = new Map([
  ["near", box(100, 100)],
  ["far", box(5000, 5000)],
  ["farther", box(-5000, 100)],
]);

describe("cullBounds", () => {
  it("grows the view box by the margin", () => {
    expect(cullBounds(viewBox, 0.5)).toEqual({
      left: -500,
      top: -500,
      right: 1500,
      bottom: 1500,
    });
  });

  it("returns null while the canvas has no size", () => {
    expect(cullBounds({ left: 0, top: 0, width: 0, height: 0 })).toBe(null);
  });
});

describe("cullElements", () => {
  const bounds = cullBounds(viewBox);

  it("keeps only tables that overlap the bounds", () => {
    const result = cullElements({ tables, relationships: [], boxes, bounds });
    expect(result.tables.map((t) => t.id)).toEqual(["near"]);
  });

  it("always keeps tables asked for, such as the selected one", () => {
    const result = cullElements({
      tables,
      relationships: [],
      boxes,
      bounds,
      keepTableIds: new Set(["far"]),
    });
    expect(result.tables.map((t) => t.id)).toEqual(["near", "far"]);
  });

  it("keeps relationships whose line can cross the view", () => {
    const relationships = [
      { id: "crossing", startTableId: "far", endTableId: "farther" },
      { id: "offscreen", startTableId: "far", endTableId: "far" },
      { id: "selected", startTableId: "far", endTableId: "far" },
    ];
    const result = cullElements({
      tables,
      relationships,
      boxes,
      bounds,
      keepRelationshipId: "selected",
    });
    expect(result.relationships.map((r) => r.id)).toEqual([
      "crossing",
      "selected",
    ]);
  });

  it("renders everything when there are no bounds", () => {
    const result = cullElements({
      tables,
      relationships: [],
      boxes,
      bounds: null,
    });
    expect(result.tables).toBe(tables);
  });
});

import { describe, expect, it } from "vitest";
import { diagramBounds, fitTransform } from "./fitView";

const table = (x, y) => ({ id: `${x},${y}`, x, y, fields: [] });

describe("fitTransform", () => {
  it("centers on the content and zooms so it fits the canvas", () => {
    const result = fitTransform(
      { tables: [table(5000, 3000), table(9000, 6000)] },
      { width: 1000, height: 800 },
    );
    const visible = {
      left: result.pan.x - 1000 / result.zoom / 2,
      right: result.pan.x + 1000 / result.zoom / 2,
      top: result.pan.y - 800 / result.zoom / 2,
      bottom: result.pan.y + 800 / result.zoom / 2,
    };
    expect(visible.left).toBeLessThanOrEqual(5000);
    expect(visible.top).toBeLessThanOrEqual(3000);
    expect(visible.right).toBeGreaterThanOrEqual(9000);
    expect(visible.bottom).toBeGreaterThanOrEqual(6000);
  });

  it("includes areas, notes and views in the bounds", () => {
    const result = fitTransform(
      {
        tables: [table(0, 0)],
        areas: [{ x: -2000, y: 0, width: 100, height: 100 }],
        notes: [{ x: 0, y: 3000, height: 50 }],
      },
      { width: 1000, height: 800 },
    );
    expect(result.pan.x).toBeLessThan(0);
    expect(result.pan.y).toBeGreaterThan(0);
  });

  it("returns null when there is nothing to fit or no canvas size", () => {
    expect(fitTransform({ tables: [] }, { width: 1000, height: 800 })).toBe(
      null,
    );
    expect(
      fitTransform({ tables: [table(0, 0)] }, { width: 0, height: 0 }),
    ).toBe(null);
  });

  it("keeps the zoom within the editor limits for huge diagrams", () => {
    const result = fitTransform(
      { tables: [table(0, 0), table(500000, 500000)] },
      { width: 1000, height: 800 },
    );
    expect(result.zoom).toBeGreaterThanOrEqual(0.05);
  });
});

describe("diagramBounds", () => {
  it("spans every element plus the padding", () => {
    const bounds = diagramBounds(
      {
        tables: [table(100, 200)],
        areas: [{ x: -50, y: 0, width: 100, height: 100 }],
      },
      true,
      20,
    );
    expect(bounds.left).toBe(-70);
    expect(bounds.top).toBe(-20);
    expect(bounds.width).toBeGreaterThan(100 + 50 + 40);
  });

  it("returns null for an empty diagram", () => {
    expect(diagramBounds({})).toBe(null);
  });
});

import { describe, expect, it } from "vitest";
import { contentTiles } from "./exportDiagram";

describe("contentTiles", () => {
  const viewBox = { left: -100, top: -100, width: 10000, height: 6000 };

  it("keeps only tiles that hold some content", () => {
    const tiles = contentTiles({
      width: 10000,
      height: 6000,
      viewBox,
      // One table near the top-left corner, one near the bottom-right.
      boxes: [
        { x: 0, y: 0, w: 200, h: 300 },
        { x: 9500, y: 5500, w: 200, h: 300 },
      ],
      tileSize: 2048,
    });
    expect(tiles).toEqual([
      { x: 0, y: 0, width: 2048, height: 2048 },
      { x: 8192, y: 4096, width: 1808, height: 1904 },
    ]);
  });

  it("maps diagram units to image pixels when they differ", () => {
    const tiles = contentTiles({
      width: 5000,
      height: 3000,
      viewBox,
      boxes: [{ x: 9500, y: 5500, w: 200, h: 300 }],
      tileSize: 2048,
    });
    expect(tiles).toEqual([{ x: 4096, y: 2048, width: 904, height: 952 }]);
  });
});

import { describe, expect, it } from "vitest";
import { exportPixelRatio } from "./exportScale";

describe("exportPixelRatio", () => {
  it("uses the desired ratio for diagrams that fit", () => {
    expect(exportPixelRatio(3000, 2000)).toBe(2);
  });

  it("lowers the ratio so the image stays within browser limits", () => {
    const ratio = exportPixelRatio(4800, 6500);
    expect(4800 * ratio * 6500 * ratio).toBeLessThanOrEqual(50_000_000 + 1);
    expect(ratio).toBeLessThan(2);
  });

  it("keeps the longest side drawable", () => {
    expect(40000 * exportPixelRatio(40000, 500)).toBeLessThanOrEqual(16384);
  });
});

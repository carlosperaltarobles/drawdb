import { describe, expect, it } from "vitest";
import {
  FLASH_MS,
  LOCATE_MIN_ZOOM,
  LOCATE_ZOOM,
  locateTransform,
} from "./locate";
import { getTableHeight, getTableWidth } from "./utils";

describe("locate", () => {
  const t = {
    id: "t1",
    name: "pedidos",
    x: 100,
    y: 200,
    fields: [
      { id: "f1", name: "id" },
      { id: "f2", name: "cliente_id" },
    ],
  };

  it("exports locate constants", () => {
    expect(LOCATE_MIN_ZOOM).toBe(0.5);
    expect(LOCATE_ZOOM).toBe(1);
    expect(FLASH_MS).toBe(1500);
  });

  it("centers on the table", () => {
    const result = locateTransform(t, 1, true, []);
    expect(result.pan).toEqual({
      x: t.x + getTableWidth(t) / 2,
      y: t.y + getTableHeight(t, true, []) / 2,
    });
  });

  it("keeps zoom at or above 0.5", () => {
    expect(locateTransform(t, 0.8, true, []).zoom).toBe(0.8);
    expect(locateTransform(t, 0.5, true, []).zoom).toBe(0.5);
  });

  it("raises low zoom to 1", () => {
    expect(locateTransform(t, 0.2, true, []).zoom).toBe(1);
  });
});

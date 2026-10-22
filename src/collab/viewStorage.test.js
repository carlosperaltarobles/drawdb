import { afterEach, describe, expect, it, vi } from "vitest";
import { load, save } from "./viewStorage";

afterEach(() => vi.unstubAllGlobals());
describe("project view storage", () => {
  it("survives unavailable storage on read and write", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
    });
    expect(load("p")).toBeNull();
    expect(() => save("p", { pan: { x: 0, y: 0 }, zoom: 1 })).not.toThrow();
  });
  it("round trips the view without document data and isolates users", () => {
    const values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k) => values.get(k),
      setItem: (k, v) => values.set(k, v),
    });
    save("p", { pan: { x: 12, y: -3 }, zoom: 2, tables: [] }, "alice");
    expect(load("p", "alice")).toEqual({ pan: { x: 12, y: -3 }, zoom: 2 });
    expect(load("p", "bob")).toBeNull();
    expect(load("other", "alice")).toBeNull();
    expect(JSON.parse(values.get("drawdb:view:p"))).not.toHaveProperty(
      "tables",
    );
  });
  it.each(["broken", "{}", '{"pan":{"x":0,"y":0},"zoom":-1}'])(
    "ignores invalid stored view %s",
    (value) => {
      vi.stubGlobal("localStorage", { getItem: () => value });
      expect(load("p")).toBeNull();
    },
  );
});

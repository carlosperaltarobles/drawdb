import { describe, it, expect } from "vitest";
import { findById, insertAt, newId, removeById, resolveId } from "./ids";

describe("ids", () => {
  it("findById works with string and legacy numeric ids", () => {
    const list = [{ id: "a" }, { id: 0 }];
    expect(findById(list, 0)).toBe(list[1]);
    expect(findById(list, "a")).toBe(list[0]);
    expect(findById(list, "zzz")).toBeUndefined();
  });

  it("newId returns a 21 character string", () => {
    const id = newId();
    expect(typeof id).toBe("string");
    expect(id).toHaveLength(21);
    expect(newId()).not.toBe(id);
  });

  it("removeById keeps the other ids unchanged", () => {
    const notes = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(removeById(notes, "b")).toEqual([{ id: "a" }, { id: "c" }]);
    const legacy = [{ id: 0 }, { id: 1 }, { id: 2 }];
    expect(removeById(legacy, 1)).toEqual([{ id: 0 }, { id: 2 }]);
  });

  it("resolveId maps a string key back to the real id", () => {
    const list = [{ id: 0 }, { id: "b" }];
    expect(resolveId(list, "0")).toBe(0);
    expect(resolveId(list, "b")).toBe("b");
    expect(resolveId(list, "nope")).toBe("nope");
  });
});

describe("insertAt", () => {
  it("restores an item at its original position", () => {
    const list = [{ id: "a" }, { id: "c" }];
    expect(insertAt(list, { id: "b" }, 1).map((e) => e.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("appends when the index is missing or beyond the end", () => {
    expect(insertAt([1], 2)).toEqual([1, 2]);
    expect(insertAt([1], 2, 9)).toEqual([1, 2]);
  });
});

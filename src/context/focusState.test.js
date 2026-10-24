import { describe, expect, it } from "vitest";
import { computeFocusedIds, resolveFocusAfterChange } from "./focusState";

const r = (a, b) => ({ id: `${a}${b}`, startTableId: a, endTableId: b });
const t = (id) => ({ id, name: id });

describe("focusState", () => {
  it("null focus gives null ids", () => {
    expect(computeFocusedIds([r("A", "B")], null)).toBeNull();
  });

  it("focused ids include related and extra tables", () => {
    const rels = [r("A", "B")];
    const focus = {
      rootId: "A",
      depth: 1,
      extraIds: new Set(["Z"]),
    };
    expect(computeFocusedIds(rels, focus)).toEqual(new Set(["A", "B", "Z"]));
  });

  it("new relationship within depth joins the group", () => {
    const focus = {
      rootId: "A",
      depth: 2,
      extraIds: new Set(),
    };
    const before = computeFocusedIds([r("A", "B")], focus);
    expect(before).toEqual(new Set(["A", "B"]));

    const after = computeFocusedIds([r("A", "B"), r("B", "D")], focus);
    expect(after).toEqual(new Set(["A", "B", "D"]));
  });

  it("deleting the root clears focus and flags it", () => {
    const tables = [t("B"), t("C")];
    const focus = {
      rootId: "A",
      depth: 1,
      extraIds: new Set(["B"]),
    };
    const res = resolveFocusAfterChange(tables, focus, "B");
    expect(res).toEqual({
      focus: null,
      relatedRootId: "B",
      focusRootDeleted: true,
      relatedRootDeleted: false,
    });
  });

  it("deleting the related root clears it and flags it", () => {
    const tables = [t("A"), t("B")];
    const focus = {
      rootId: "A",
      depth: 1,
      extraIds: new Set(),
    };
    const res = resolveFocusAfterChange(tables, focus, "C");
    expect(res.focus).toEqual(focus);
    expect(res.relatedRootId).toBeNull();
    expect(res.focusRootDeleted).toBe(false);
    expect(res.relatedRootDeleted).toBe(true);
  });

  it("extra ids that no longer exist are dropped", () => {
    const tables = [t("A"), t("B")];
    const focus = {
      rootId: "A",
      depth: 2,
      extraIds: new Set(["B", "Z"]),
    };
    const res = resolveFocusAfterChange(tables, focus, null);
    expect(res.focus).toEqual({
      rootId: "A",
      depth: 2,
      extraIds: new Set(["B"]),
    });
    expect(res.relatedRootId).toBeNull();
    expect(res.focusRootDeleted).toBe(false);
    expect(res.relatedRootDeleted).toBe(false);
  });
});

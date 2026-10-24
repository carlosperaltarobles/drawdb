import { describe, expect, it } from "vitest";
import {
  LAYOUT_FIELDS,
  sameIgnoringLayout,
  tablesSameIgnoringLayout,
} from "./layoutFields";

const baseTable = {
  id: "t1",
  name: "users",
  x: 10,
  y: 20,
  width: 220,
  hidden: false,
  collapsed: false,
  comment: "",
  color: "#175e7a",
  fields: [{ id: "f1", name: "id", type: "INT" }],
};

describe("layoutFields", () => {
  it("exports exact layout fields", () => {
    expect(LAYOUT_FIELDS).toEqual(["x", "y", "width"]);
  });

  it("returns true for same object or layout-only changes", () => {
    expect(sameIgnoringLayout(baseTable, baseTable)).toBe(true);
    expect(sameIgnoringLayout(baseTable, { ...baseTable, x: 5 })).toBe(true);
    expect(sameIgnoringLayout(baseTable, { ...baseTable, y: 5 })).toBe(true);
    expect(sameIgnoringLayout(baseTable, { ...baseTable, width: 300 })).toBe(
      true,
    );
  });

  it("returns false when non-layout fields change", () => {
    expect(sameIgnoringLayout(baseTable, { ...baseTable, name: "n" })).toBe(
      false,
    );
    expect(sameIgnoringLayout(baseTable, { ...baseTable, hidden: true })).toBe(
      false,
    );
    expect(
      sameIgnoringLayout(baseTable, { ...baseTable, collapsed: true }),
    ).toBe(false);
    expect(sameIgnoringLayout(baseTable, { ...baseTable, comment: "c" })).toBe(
      false,
    );
    expect(sameIgnoringLayout(baseTable, { ...baseTable, color: "#fff" })).toBe(
      false,
    );
    expect(
      sameIgnoringLayout(baseTable, {
        ...baseTable,
        fields: [...baseTable.fields],
      }),
    ).toBe(false);
  });

  it("returns false when a key is added or removed", () => {
    expect(sameIgnoringLayout(baseTable, { ...baseTable, extra: 1 })).toBe(
      false,
    );
    const withoutComment = { ...baseTable };
    delete withoutComment.comment;
    expect(sameIgnoringLayout(baseTable, withoutComment)).toBe(false);
    const withoutWidth = { ...baseTable };
    delete withoutWidth.width;
    expect(sameIgnoringLayout(baseTable, withoutWidth)).toBe(false);
  });

  it("compares table arrays ignoring layout fields", () => {
    const t2 = { ...baseTable, id: "t2", name: "orders" };
    const list = [baseTable, t2];

    expect(tablesSameIgnoringLayout(list, [baseTable])).toBe(false);
    expect(tablesSameIgnoringLayout(list, [t2, baseTable])).toBe(false);
    expect(
      tablesSameIgnoringLayout(list, [{ ...baseTable, x: 999 }, t2]),
    ).toBe(true);
  });
});

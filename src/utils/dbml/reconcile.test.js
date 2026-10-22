import { describe, it, expect } from "vitest";
import { reconcileDbml } from "./reconcile";

const field = (name) => ({
  name,
  type: "INTEGER",
  primary: false,
  unique: false,
  notNull: false,
  increment: false,
  default: "",
  comment: "",
});

describe("reconcileDbml indices", () => {
  it("never gives two indices the same id", () => {
    const base = {
      tables: [
        {
          id: "t1",
          name: "users",
          comment: "",
          color: "#175e7a",
          fields: [{ ...field("a"), id: "f1" }],
          indices: [
            { id: 1, name: "A", fields: ["a"], unique: false },
            { id: 2, name: "B", fields: ["a"], unique: false },
          ],
          uniqueConstraints: [],
        },
      ],
      relationships: [],
      enums: [],
    };
    const parsed = {
      tables: [
        {
          name: "users",
          comment: "",
          color: null,
          fields: [field("a")],
          indices: [
            { name: "B", fields: ["a"], unique: false },
            { name: "X", fields: ["a"], unique: false },
          ],
        },
      ],
      relationships: [],
      enums: [],
    };

    const { indices } = reconcileDbml(parsed, base, "generic").tables[0];

    expect(indices[0].id).toBe(2);
    expect(new Set(indices.map((i) => i.id)).size).toBe(2);
  });
});

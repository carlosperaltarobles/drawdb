import { describe, expect, it } from "vitest";
import { applyOp, applyOps, diffDoc } from "./ops";
import fixtures from "./__fixtures__/ops.fixtures.json";

const base = () => ({
  database: "generic",
  sqlHeader: "",
  tables: [
    {
      id: "t",
      name: "Table",
      fields: [{ id: 0, name: "a" }],
      indices: [],
      uniqueConstraints: [],
    },
  ],
  relationships: [],
  notes: [],
  areas: [],
  views: [],
  enums: [],
  types: [],
});

describe("granular document operations", () => {
  it("keeps concurrent column additions and patches of separate properties", () => {
    const doc = applyOps(base(), [
      {
        t: "sadd",
        coll: "tables",
        id: "t",
        sub: "fields",
        item: { id: "x", name: "x" },
        index: 1,
      },
      {
        t: "sadd",
        coll: "tables",
        id: "t",
        sub: "fields",
        item: { id: "y", name: "y" },
        index: 1,
      },
      {
        t: "spatch",
        coll: "tables",
        id: "t",
        sub: "fields",
        sid: 0,
        patch: { name: "renamed" },
      },
    ]).doc;
    expect(doc.tables[0].fields).toEqual([
      { id: 0, name: "renamed" },
      { id: "y", name: "y" },
      { id: "x", name: "x" },
    ]);
  });
  it("rejects stale patches, makes add/delete idempotent and preserves unlisted items when ordering", () => {
    const start = base();
    const result = applyOps(start, [
      { t: "patch", coll: "tables", id: "missing", patch: { name: "bad" } },
      {
        t: "add",
        coll: "tables",
        item: { id: "t", name: "duplicate" },
        index: 0,
      },
      { t: "del", coll: "notes", id: "missing" },
      {
        t: "sadd",
        coll: "tables",
        id: "t",
        sub: "fields",
        item: { id: "x" },
        index: 0,
      },
      {
        t: "sorder",
        coll: "tables",
        id: "t",
        sub: "fields",
        ids: [0, "unknown"],
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.doc.tables[0].name).toBe("Table");
    expect(result.doc.tables[0].fields.map((x) => x.id)).toEqual([0, "x"]);
    expect(start.tables[0].fields).toEqual([{ id: 0, name: "a" }]);
  });
  it("protects ids and subcollections from shallow patches, supports unset", () => {
    const result = applyOps(base(), [
      {
        t: "patch",
        coll: "tables",
        id: "t",
        patch: { id: "evil", fields: [], name: "new" },
        unset: ["id", "fields", "name"],
      },
    ]);
    expect(result.doc.tables[0]).toEqual({
      id: "t",
      fields: [{ id: 0, name: "a" }],
      indices: [],
      uniqueConstraints: [],
    });
  });
  it("shares unchanged structures and ignores pan and zoom", () => {
    const start = base();
    expect(diffDoc(start, { ...start, pan: { x: 3, y: 5 }, zoom: 3 })).toEqual(
      [],
    );
    const next = applyOps(start, [
      { t: "set", key: "sqlHeader", value: "-- team" },
    ]).doc;
    expect(next.tables).toBe(start.tables);
  });
  for (const fixture of fixtures) {
    it(`shared fixture: ${fixture.name}`, () => {
      const result = applyOps(fixture.base, fixture.ops);
      expect(result.doc).toEqual(fixture.expected);
      expect(result.ok).toBe(fixture.ok);
    });
  }
  it("preserves references outside the changed nested field", () => {
    const start = base();
    const result = applyOp(start, {
      t: "spatch",
      coll: "tables",
      id: "t",
      sub: "fields",
      sid: 0,
      patch: { name: "changed" },
    });
    expect(result.doc).not.toBe(start);
    expect(result.doc.tables[0]).not.toBe(start.tables[0]);
    expect(result.doc.tables[0].indices).toBe(start.tables[0].indices);
    expect(result.doc.notes).toBe(start.notes);
    expect(start.tables[0].fields[0].name).toBe("a");
    expect(applyOps(start, []).doc).toBe(start);
    expect(
      applyOp(start, { t: "del", coll: "tables", id: "missing" }).doc,
    ).toBe(start);
  });
  it("orders only for changed relative order of surviving identities", () => {
    const prev = { notes: [{ id: "a" }, { id: "b" }] };
    const inserted = { notes: [{ id: "x" }, ...prev.notes] };
    expect(diffDoc(prev, inserted).map((op) => op.t)).toEqual(["add"]);
    const reordered = { notes: [{ id: "b" }, { id: "x" }, { id: "a" }] };
    expect(diffDoc(prev, reordered).map((op) => op.t)).toEqual([
      "add",
      "order",
    ]);
    expect(applyOps(prev, diffDoc(prev, reordered)).doc).toEqual(reordered);
  });
  it("reports accepted idempotent operations while continuing after failure", () => {
    const ops = [
      { t: "patch", coll: "notes", id: "missing", patch: { name: "bad" } },
      { t: "del", coll: "notes", id: "missing" },
      { t: "add", coll: "notes", item: { id: "new" }, index: 50 },
    ];
    const result = applyOps(base(), ops);
    expect(result.applied).toEqual(ops.slice(1));
    expect(result.ok).toBe(false);
    expect(result.doc.notes).toEqual([{ id: "new" }]);
  });
  it("roundtrips 200 seeded pairs with table/field/note/enum creation, deletion, edits and order", () => {
    let seed = 137;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const shuffle = (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    };
    const items = (prefix, size, make) =>
      shuffle(
        Array.from({ length: size }, (_, i) => i)
          .filter(() => random() > 0.3)
          .map((i) => ({ id: i % 2 ? `${prefix}${i}` : i, ...make(i) })),
      );
    const makeDoc = () => ({
      database: random() > 0.5 ? "generic" : "postgresql",
      sqlHeader: random() > 0.5 ? "" : "-- team",
      tables: items("t", 6, () => ({
        name: `table${Math.floor(random() * 10)}`,
        ...(random() > 0.5 ? { comment: "optional" } : {}),
        fields: items("f", 8, () => ({
          name: `field${Math.floor(random() * 10)}`,
          type: random() > 0.5 ? "INT" : "TEXT",
        })),
        indices: items("idx", 3, () => ({
          name: `index${Math.floor(random() * 3)}`,
        })),
        uniqueConstraints: [],
      })),
      relationships: [],
      areas: [],
      views: [],
      types: [],
      notes: items("n", 6, () => ({
        title: `note${Math.floor(random() * 10)}`,
      })),
      enums: items("e", 5, () => ({
        values: random() > 0.5 ? ["a", "b"] : ["c"],
      })),
    });
    for (let i = 0; i < 200; i++) {
      const prev = makeDoc();
      const next = makeDoc();
      const original = structuredClone(prev);
      const result = applyOps(prev, diffDoc(prev, next));
      expect(result.ok).toBe(true);
      expect(result.doc).toEqual(next);
      expect(prev).toEqual(original);
    }
  });
});

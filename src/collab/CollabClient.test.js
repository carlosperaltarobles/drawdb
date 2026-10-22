import { describe, expect, it } from "vitest";
import { CollabClient } from "./CollabClient";
import { colorFor, COLORS } from "./colors";

const doc = () => ({ tables: [{ id: "t", fields: [] }], notes: [], enums: [] });
const addField = (id) => ({
  t: "sadd",
  coll: "tables",
  id: "t",
  sub: "fields",
  item: { id },
  index: 0,
});
function setup() {
  const sent = [];
  const client = new CollabClient({ send: (batch) => sent.push(batch) });
  client.resetFromSnapshot({ doc: doc(), version: 0 });
  return { client, sent };
}
describe("CollabClient", () => {
  it("sends one table addition and skips identical documents", () => {
    const { client, sent } = setup();
    client.local(client.shadow);
    expect(sent).toEqual([]);
    client.local({
      ...client.shadow,
      tables: [...client.shadow.tables, { id: "new" }],
    });
    expect(sent).toEqual([
      {
        seq: 1,
        ops: [{ t: "add", coll: "tables", item: { id: "new" }, index: 1 }],
      },
    ]);
    expect(client.hasPending).toBe(true);
  });
  it("rebases pending fields on remote fields and confirms both on ack", () => {
    const { client } = setup();
    client.local({
      ...client.shadow,
      tables: [{ id: "t", fields: [{ id: "x" }] }],
    });
    expect(
      client.remote({ version: 1, ops: [addField("y")] }).tables[0].fields,
    ).toEqual([{ id: "x" }, { id: "y" }]);
    expect(client.ack({ seq: 1, version: 2, ok: true })).toBe("ok");
    expect(client.hasPending).toBe(false);
    expect(client.remote({ version: 3, ops: [] }).tables[0].fields).toEqual([
      { id: "x" },
      { id: "y" },
    ]);
  });
  it("requires resync for skipped remote versions without changing state", () => {
    const { client } = setup();
    const before = client.shadow;
    expect(client.remote({ version: 2, ops: [addField("x")] })).toBe("resync");
    expect(client.shadow).toBe(before);
    expect(client.version).toBe(0);
  });
  it("drops pending batches on reset without reusing sequence numbers", () => {
    const { client, sent } = setup();
    client.local({ ...client.shadow, notes: [{ id: "n" }] });
    client.resetFromSnapshot({ doc: doc(), version: 10 });
    expect(client.hasPending).toBe(false);
    client.local({ ...client.shadow, notes: [{ id: "other" }] });
    expect(sent[1].seq).toBe(2);
    expect(client.ack({ seq: 1, version: 11, ok: true })).toBe("resync");
  });
  it("rejects failed, missing, noninteger and out of order acknowledgements", () => {
    const { client } = setup();
    client.local({ ...client.shadow, notes: [{ id: "n" }] });
    client.local({ ...client.shadow, enums: [{ id: "e" }] });
    for (const ack of [
      { seq: 1, version: 1, ok: false },
      { seq: 2, version: 1, ok: true },
      { seq: 99, version: 1, ok: true },
      { seq: 1.5, version: 1, ok: true },
      { seq: 1, version: 2, ok: true },
    ]) {
      expect(client.ack(ack)).toBe("resync");
      expect(client.version).toBe(0);
      expect(client.hasPending).toBe(true);
    }
    expect(client.ack({ seq: 1, version: 1, ok: true })).toBe("ok");
    expect(client.hasPending).toBe(true);
    expect(client.ack({ seq: 2, version: 2, ok: true })).toBe("ok");
    expect(client.hasPending).toBe(false);
  });
  it("requests resync when a pending patch targets a remotely deleted table", () => {
    const { client } = setup();
    client.local({
      ...client.shadow,
      tables: [{ ...client.shadow.tables[0], name: "renamed" }],
    });
    expect(
      client.remote({
        version: 1,
        ops: [{ t: "del", coll: "tables", id: "t" }],
      }),
    ).toBe("resync");
    expect(client.version).toBe(0);
  });
});
it("assigns stable colors from the shared twelve-color palette", () => {
  expect(COLORS).toHaveLength(12);
  expect(new Set(COLORS).size).toBe(12);
  expect(colorFor("alice")).toBe(colorFor("alice"));
  expect(COLORS).toContain(colorFor("alice"));
  expect(colorFor("a")).toBe("#dc2626");
  expect(colorFor("abc")).toBe("#db2777");
  expect(colorFor("")).toBe("#2563eb");
});

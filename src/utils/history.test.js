import { describe, expect, it } from "vitest";
import { Action, ObjectType } from "../data/constants";
import {
  historyTargetExists,
  restoreAddedField,
  applyHistorySnapshot,
} from "./history";

describe("collaborative editor history", () => {
  it("redo preserves the field id so the next undo removes it without removing a remote field", () => {
    const fields = [{ id: "remote", name: "Remote" }];
    const restored = restoreAddedField(fields, { fid: "local" });
    expect(restored.map((f) => f.id)).toEqual(["remote", "local"]);
    expect(restored.filter((f) => f.id !== "local")).toEqual(fields);
    expect(restoreAddedField(restored, { fid: "local" })).toBe(restored);
  });
  it("skips move and edit entries whose entity was deleted remotely", () => {
    const doc = { tables: [], notes: [], areas: [], types: [] };
    expect(
      historyTargetExists(
        { action: Action.MOVE, element: ObjectType.TABLE, id: "gone" },
        doc,
      ),
    ).toBe(false);
    expect(
      historyTargetExists(
        { action: Action.MOVE, element: ObjectType.NOTE, id: "gone" },
        doc,
      ),
    ).toBe(false);
    expect(
      historyTargetExists(
        {
          action: Action.EDIT,
          element: ObjectType.TABLE,
          tid: "gone",
          component: "field_add",
        },
        doc,
      ),
    ).toBe(false);
    expect(
      historyTargetExists(
        {
          action: Action.EDIT,
          element: ObjectType.TYPE,
          tid: 0,
          component: "field",
        },
        doc,
      ),
    ).toBe(false);
    expect(
      historyTargetExists(
        { action: Action.DELETE, element: ObjectType.TABLE },
        doc,
      ),
    ).toBe(true);
  });
  it("applies only the local DBML inverse and preserves remote additions", () => {
    const before = {
      tables: [{ id: "t", name: "before", fields: [] }],
      relationships: [],
      enums: [],
    };
    const after = {
      ...before,
      tables: [{ ...before.tables[0], name: "after" }],
    };
    const current = {
      ...after,
      tables: [
        { ...after.tables[0], fields: [{ id: "remote-field" }] },
        { id: "remote-table", fields: [] },
      ],
    };
    const result = applyHistorySnapshot(current, after, before);
    expect(result.tables).toEqual([
      { id: "t", name: "before", fields: [{ id: "remote-field" }] },
      { id: "remote-table", fields: [] },
    ]);
  });
});

import { Action, ObjectType } from "../data/constants";
import { applyOps, diffDoc } from "../collab/ops";

export function restoreAddedField(fields, action) {
  if (fields.some((field) => field.id === action.fid)) return fields;
  return [
    ...fields,
    {
      name: "",
      type: "",
      default: "",
      check: "",
      primary: false,
      unique: false,
      notNull: false,
      increment: false,
      comment: "",
      id: action.fid,
    },
  ];
}

export function historyTargetExists(action, doc) {
  if (action.bulk || ![Action.MOVE, Action.EDIT].includes(action.action))
    return true;
  const targets = {
    [ObjectType.TABLE]: [doc.tables, action.tid ?? action.id],
    [ObjectType.AREA]: [doc.areas, action.aid ?? action.id],
    [ObjectType.NOTE]: [doc.notes, action.nid ?? action.id],
    [ObjectType.RELATIONSHIP]: [doc.relationships, action.rid ?? action.id],
    [ObjectType.TYPE]: [doc.types, action.tid],
    [ObjectType.ENUM]: [doc.enums, action.id],
    [ObjectType.VIEW]: [doc.views, action.vid ?? action.id],
  };
  const target = targets[action.element];
  if (!target) return true;
  const [items = [], id] = target;
  return items.some(
    (item, index) =>
      item.id === id ||
      (action.element === ObjectType.TYPE &&
        typeof id === "number" &&
        index === id),
  );
}

// Missing targets are skipped by applyOps: history cannot resurrect remote deletions.
export function applyHistorySnapshot(current, from, to) {
  return applyOps(current, diffDoc(from, to)).doc;
}

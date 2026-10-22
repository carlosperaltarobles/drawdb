// Mantener sincronizado con BE/src/collab/ops.ts.
import isEqual from "lodash/isEqual";

export const COLLS = [
  "tables",
  "relationships",
  "notes",
  "areas",
  "views",
  "enums",
  "types",
];
export const SUBS = { tables: ["fields", "indices", "uniqueConstraints"] };

function patchItem(item, patch = {}, unset = [], protectedKeys = []) {
  const result = { ...item };
  const protectedSet = new Set(["id", ...protectedKeys]);
  for (const [key, value] of Object.entries(patch)) {
    if (!protectedSet.has(key))
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  for (const key of unset) if (!protectedSet.has(key)) delete result[key];
  return isEqual(result, item) ? item : result;
}

function changeList(items, op, sub = false) {
  const id = sub ? op.sid : op.id;
  const kind = sub ? op.t.slice(1) : op.t;
  if (kind === "add") {
    if (items.some((item) => item.id === op.item.id))
      return { items, ok: true };
    const next = [...items];
    next.splice(Math.max(0, Math.min(op.index, next.length)), 0, op.item);
    return { items: next, ok: true };
  }
  if (kind === "order") {
    const byId = new Map(items.map((item) => [item.id, item]));
    const next = [];
    for (const itemId of op.ids) {
      if (byId.has(itemId)) {
        next.push(byId.get(itemId));
        byId.delete(itemId);
      }
    }
    next.push(...items.filter((item) => byId.has(item.id)));
    return {
      items: next.every((item, i) => item === items[i]) ? items : next,
      ok: true,
    };
  }
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { items, ok: kind === "del" };
  if (kind === "del")
    return { items: items.filter((_, i) => i !== index), ok: true };
  if (kind !== "patch") return { items, ok: false };
  const item = patchItem(
    items[index],
    op.patch,
    op.unset,
    sub ? [] : SUBS[op.coll],
  );
  if (item === items[index]) return { items, ok: true };
  const next = [...items];
  next[index] = item;
  return { items: next, ok: true };
}

export function applyOp(doc, op) {
  if (op.t === "set") {
    if (!["database", "sqlHeader"].includes(op.key)) return { doc, ok: false };
    return {
      doc: isEqual(doc[op.key], op.value)
        ? doc
        : { ...doc, [op.key]: op.value },
      ok: true,
    };
  }
  if (!COLLS.includes(op.coll)) return { doc, ok: false };
  const items = doc[op.coll] ?? [];
  if (["sadd", "sdel", "spatch", "sorder"].includes(op.t)) {
    if (!SUBS[op.coll]?.includes(op.sub)) return { doc, ok: false };
    const index = items.findIndex((item) => item.id === op.id);
    if (index < 0) return { doc, ok: false };
    const previous = items[index][op.sub] ?? [];
    const result = changeList(previous, op, true);
    if (result.items === previous) return { doc, ok: result.ok };
    const next = [...items];
    next[index] = { ...items[index], [op.sub]: result.items };
    return { doc: { ...doc, [op.coll]: next }, ok: result.ok };
  }
  const result = changeList(items, op);
  return {
    doc: result.items === items ? doc : { ...doc, [op.coll]: result.items },
    ok: result.ok,
  };
}

export function applyOps(doc, ops) {
  let next = doc;
  let ok = true;
  const applied = [];
  for (const op of ops) {
    const result = applyOp(next, op);
    next = result.doc;
    if (result.ok) applied.push(op);
    else ok = false;
  }
  return { doc: next, applied, ok };
}

function diffPatch(prev, next, excluded) {
  const patch = {};
  const unset = [];
  for (const key of Object.keys(next)) {
    if (!excluded.includes(key) && !isEqual(prev[key], next[key])) {
      Object.defineProperty(patch, key, {
        value: next[key],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  for (const key of Object.keys(prev)) {
    if (!excluded.includes(key) && !Object.hasOwn(next, key)) unset.push(key);
  }
  return { patch, ...(unset.length ? { unset } : {}) };
}

function diffList(prev = [], next = [], scope, ops, sub = false) {
  if (prev === next || isEqual(prev, next)) return;
  const before = new Map(prev.map((item) => [item.id, item]));
  const after = new Map(next.map((item) => [item.id, item]));
  const kind = (t) => (sub ? `s${t}` : t);
  const identity = (id) => (sub ? { sid: id } : { id });
  for (const item of prev)
    if (!after.has(item.id))
      ops.push({ t: kind("del"), ...scope, ...identity(item.id) });
  next.forEach((item, index) => {
    if (!before.has(item.id))
      ops.push({ t: kind("add"), ...scope, item, index });
  });
  for (const item of next) {
    const previous = before.get(item.id);
    if (!previous || previous === item || isEqual(previous, item)) continue;
    const subs = sub ? [] : SUBS[scope.coll] ?? [];
    const delta = diffPatch(previous, item, ["id", ...subs]);
    if (Object.keys(delta.patch).length || delta.unset?.length)
      ops.push({ t: kind("patch"), ...scope, ...identity(item.id), ...delta });
    for (const name of subs)
      diffList(
        previous[name],
        item[name],
        { coll: scope.coll, id: item.id, sub: name },
        ops,
        true,
      );
  }
  const prevCommon = prev
    .filter((item) => after.has(item.id))
    .map((item) => item.id);
  const nextCommon = next
    .filter((item) => before.has(item.id))
    .map((item) => item.id);
  if (!isEqual(prevCommon, nextCommon))
    ops.push({ t: kind("order"), ...scope, ids: next.map((item) => item.id) });
}

export function diffDoc(prev, next) {
  if (prev === next) return [];
  const ops = [];
  for (const key of ["database", "sqlHeader"])
    if (!isEqual(prev[key], next[key]))
      ops.push({ t: "set", key, value: next[key] });
  for (const coll of COLLS) diffList(prev[coll], next[coll], { coll }, ops);
  return ops;
}

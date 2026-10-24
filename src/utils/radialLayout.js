import { getTableHeight, getTableWidth } from "./utils";

const GAP = 40;
const START_ANGLE = -Math.PI / 2;

function hopRings(tables, relationships, rootId) {
  const ids = new Set(tables.map((t) => t.id));
  const neighbors = new Map(tables.map((t) => [t.id, []]));
  for (const r of relationships) {
    if (!ids.has(r.startTableId) || !ids.has(r.endTableId)) continue;
    if (r.startTableId === r.endTableId) continue;
    neighbors.get(r.startTableId).push(r.endTableId);
    neighbors.get(r.endTableId).push(r.startTableId);
  }

  const parent = new Map([[rootId, null]]);
  const rings = [[rootId]];
  for (let frontier = rings[0]; frontier.length > 0; ) {
    const next = [];
    for (const id of frontier) {
      for (const n of neighbors.get(id)) {
        if (parent.has(n)) continue;
        parent.set(n, id);
        next.push(n);
      }
    }
    if (next.length > 0) rings.push(next);
    frontier = next;
  }

  const unreachable = tables.filter((t) => !parent.has(t.id)).map((t) => t.id);
  if (unreachable.length > 0) rings.push(unreachable);
  return { rings, parent };
}

function ringFits(radius, nodes) {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const delta = Math.abs(nodes[i].angle - nodes[j].angle);
      const chord =
        2 * radius * Math.sin(Math.min(delta, 2 * Math.PI - delta) / 2);
      if (chord < (nodes[i].diag + nodes[j].diag) / 2 + GAP) return false;
    }
  }
  return true;
}

/**
 * Places the root table at the origin and the rest on rings by hop distance,
 * each table next to the one it was reached from. Only x and y change.
 */
export function radialLayout(tables, relationships, rootId, showComments) {
  if (tables.length === 0) return tables;
  const root = tables.some((t) => t.id === rootId) ? rootId : tables[0].id;

  const sizes = new Map(
    tables.map((t) => {
      const w = getTableWidth(t);
      const h = getTableHeight(t, showComments, relationships);
      return [t.id, { w, h, diag: Math.hypot(w, h) }];
    }),
  );
  const order = new Map(tables.map((t, i) => [t.id, i]));
  const { rings, parent } = hopRings(tables, relationships, root);

  const centers = new Map([[root, { x: 0, y: 0, angle: START_ANGLE }]]);
  let prevRadius = 0;
  let prevMaxDiag = sizes.get(root).diag;

  for (const ring of rings.slice(1)) {
    const parentAngle = (id) => centers.get(parent.get(id))?.angle ?? Infinity;
    const sorted = [...ring].sort(
      (a, b) => parentAngle(a) - parentAngle(b) || order.get(a) - order.get(b),
    );
    const shares = sorted.map((id) => sizes.get(id).diag + GAP);
    const total = shares.reduce((s, v) => s + v, 0);

    let angle = START_ANGLE;
    const nodes = sorted.map((id, i) => {
      const span = (shares[i] / total) * 2 * Math.PI;
      const node = { id, diag: sizes.get(id).diag, angle: angle + span / 2 };
      angle += span;
      return node;
    });

    const maxDiag = Math.max(...nodes.map((n) => n.diag));
    let radius = Math.max(
      prevRadius + prevMaxDiag / 2 + maxDiag / 2 + GAP,
      total / (2 * Math.PI),
    );
    while (!ringFits(radius, nodes)) radius *= 1.05;

    for (const n of nodes) {
      centers.set(n.id, {
        x: radius * Math.cos(n.angle),
        y: radius * Math.sin(n.angle),
        angle: n.angle,
      });
    }
    prevRadius = radius;
    prevMaxDiag = maxDiag;
  }

  return tables.map((t) => {
    const c = centers.get(t.id);
    const { w, h } = sizes.get(t.id);
    return { ...t, x: c.x - w / 2, y: c.y - h / 2 };
  });
}

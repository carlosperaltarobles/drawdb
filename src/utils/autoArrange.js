import { graphlib, layout } from "@dagrejs/dagre";
import { tableWidth as defaultTableWidth } from "../data/constants";
import { getTableHeight, getTableWidth } from "./utils";

const nodeSep = 60;
const rankSep = 110;
const isolatedGap = 60;
const groupGap = 160;

export const ARRANGE_MODES = ["horizontal", "vertical", "groups"];

// A table is "central" (clinicas, users…) when it links to many others.
// Grouping ignores those links, otherwise every table ends in one block.
const hubMinNeighbors = 8;
const hubShare = 0.15;

export function autoArrange(
  tables,
  relationships,
  settings,
  mode = "horizontal",
) {
  const movable = tables.filter((table) => !table.locked);
  const movableIds = new Set(movable.map((table) => table.id));
  const sizeOf = (table) => ({
    width: getTableWidth(table),
    height: getTableHeight(table, settings.showComments, relationships),
  });

  const edges = [];
  for (const r of relationships) {
    if (
      r.startTableId !== r.endTableId &&
      movableIds.has(r.startTableId) &&
      movableIds.has(r.endTableId)
    ) {
      edges.push([r.startTableId, r.endTableId]);
    }
  }

  if (mode === "groups") return arrangeInGroups(movable, edges, sizeOf);

  const connectedIds = new Set(edges.flat());
  const connected = movable.filter((table) => connectedIds.has(table.id));
  const isolated = movable.filter((table) => !connectedIds.has(table.id));

  const graph = layered(
    connected,
    edges,
    mode === "vertical" ? "TB" : "LR",
    sizeOf,
  );
  const positions = [...graph.positions];

  if (isolated.length > 0) {
    const rowWidth = Math.max(
      graph.width,
      4 * defaultTableWidth + 3 * isolatedGap,
    );
    const grid = rows(isolated, sizeOf, rowWidth, isolatedGap);
    const offsetY = connected.length > 0 ? graph.height + rankSep : 0;
    for (const p of grid.positions) {
      positions.push({ id: p.id, x: p.x, y: p.y + offsetY });
    }
  }

  return positions;
}

// Hierarchical layout of one set of tables, with its top-left corner at 0,0.
function layered(tables, edges, rankdir, sizeOf) {
  if (tables.length === 0) return { positions: [], width: 0, height: 0 };

  const ids = new Set(tables.map((table) => table.id));
  const graph = new graphlib.Graph();
  graph.setGraph({ rankdir, nodesep: nodeSep, ranksep: rankSep });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const table of tables) {
    graph.setNode(String(table.id), sizeOf(table));
  }
  for (const [from, to] of edges) {
    if (ids.has(from) && ids.has(to)) graph.setEdge(String(from), String(to));
  }

  layout(graph);

  const placed = tables.map((table) => {
    const node = graph.node(String(table.id));
    return {
      id: table.id,
      x: node.x - node.width / 2,
      y: node.y - node.height / 2,
      width: node.width,
      height: node.height,
    };
  });
  return normalize(placed);
}

// Tables in rows of at most rowWidth, left to right.
function rows(tables, sizeOf, rowWidth, gap) {
  const placed = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const table of tables) {
    const { width, height } = sizeOf(table);
    if (x > 0 && x + width > rowWidth) {
      x = 0;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    placed.push({ id: table.id, x, y, width, height });
    x += width + gap;
    rowHeight = Math.max(rowHeight, height);
  }
  return normalize(placed);
}

function normalize(placed) {
  if (placed.length === 0) return { positions: [], width: 0, height: 0 };
  const minX = Math.min(...placed.map((p) => p.x));
  const minY = Math.min(...placed.map((p) => p.y));
  let width = 0;
  let height = 0;
  const positions = placed.map((p) => {
    const x = p.x - minX;
    const y = p.y - minY;
    width = Math.max(width, x + p.width);
    height = Math.max(height, y + p.height);
    return { id: p.id, x, y };
  });
  return { positions, width, height };
}

// Splits the diagram into blocks of related tables, lays out each block on
// its own and packs the blocks like tiles. Central tables go on top.
function arrangeInGroups(tables, edges, sizeOf) {
  const neighbors = new Map(tables.map((table) => [table.id, new Set()]));
  for (const [from, to] of edges) {
    neighbors.get(from).add(to);
    neighbors.get(to).add(from);
  }

  const connectedCount = [...neighbors.values()].filter((n) => n.size).length;
  const hubThreshold = Math.max(
    hubMinNeighbors,
    Math.ceil(connectedCount * hubShare),
  );
  const hubIds = new Set(
    tables
      .filter((table) => neighbors.get(table.id).size >= hubThreshold)
      .map((table) => table.id),
  );

  const byId = new Map(tables.map((table) => [table.id, table]));
  const visited = new Set();
  const groups = [];
  const loose = [];
  for (const table of tables) {
    if (hubIds.has(table.id) || visited.has(table.id)) continue;
    const group = [];
    const stack = [table.id];
    visited.add(table.id);
    while (stack.length > 0) {
      const id = stack.pop();
      group.push(byId.get(id));
      for (const next of neighbors.get(id)) {
        if (!hubIds.has(next) && !visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    if (group.length > 1) groups.push(group);
    else loose.push(group[0]);
  }

  const blocks = groups.map((group) => {
    const wide = layered(group, edges, "LR", sizeOf);
    const tall = layered(group, edges, "TB", sizeOf);
    return squareness(wide) <= squareness(tall) ? wide : tall;
  });

  // Tables linked only to central ones (or to nothing) share one block.
  if (loose.length > 0) {
    const area = loose.reduce((sum, t) => {
      const { width, height } = sizeOf(t);
      return sum + (width + isolatedGap) * (height + isolatedGap);
    }, 0);
    const rowWidth = Math.max(defaultTableWidth, Math.sqrt(area) * 1.5);
    blocks.push(rows(loose, sizeOf, rowWidth, isolatedGap));
  }

  blocks.sort((a, b) => b.width * b.height - a.width * a.height);

  const totalArea = blocks.reduce(
    (sum, b) => sum + (b.width + groupGap) * (b.height + groupGap),
    0,
  );
  const shelfWidth = Math.max(
    blocks.length > 0 ? blocks[0].width : 0,
    Math.sqrt(totalArea) * 1.6,
  );

  const packed = [];
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let usedWidth = 0;
  for (const block of blocks) {
    if (x > 0 && x + block.width > shelfWidth) {
      x = 0;
      y += shelfHeight + groupGap;
      shelfHeight = 0;
    }
    for (const p of block.positions) {
      packed.push({ id: p.id, x: p.x + x, y: p.y + y });
    }
    x += block.width + groupGap;
    usedWidth = Math.max(usedWidth, x - groupGap);
    shelfHeight = Math.max(shelfHeight, block.height);
  }

  if (hubIds.size === 0) return packed;

  // Central tables in a row above the blocks, centered, most linked first.
  const hubs = tables
    .filter((table) => hubIds.has(table.id))
    .sort((a, b) => neighbors.get(b.id).size - neighbors.get(a.id).size);
  const hubRow = rows(hubs, sizeOf, Infinity, groupGap);
  const offsetX = Math.max(0, (usedWidth - hubRow.width) / 2);
  const offsetY = hubRow.height + groupGap;

  return [
    ...hubRow.positions.map((p) => ({ id: p.id, x: p.x + offsetX, y: p.y })),
    ...packed.map((p) => ({ id: p.id, x: p.x, y: p.y + offsetY })),
  ];
}

function squareness(block) {
  const long = Math.max(block.width, block.height);
  const short = Math.max(1, Math.min(block.width, block.height));
  return long / short;
}

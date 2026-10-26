import { SIMPLIFIED_TABLE_ZOOM, cullBounds } from "../utils/culling";
import { LOCATE_MIN_ZOOM, LOCATE_ZOOM } from "../utils/locate";
import { getTableHeight, getTableWidth } from "../utils/utils";

const INDEX_COLLS = ["tables", "areas", "notes", "views", "relationships"];
const docEntityCache = new WeakMap();

function getDocIndex(doc) {
  if (!doc || typeof doc !== "object") return new Map();
  let cached = docEntityCache.get(doc);
  if (cached) return cached;
  cached = new Map();
  for (const coll of INDEX_COLLS) {
    const map = new Map();
    const list = Array.isArray(doc[coll]) ? doc[coll] : [];
    for (const item of list) {
      if (item && item.id !== undefined) {
        map.set(item.id, item);
      }
    }
    cached.set(coll, map);
  }
  docEntityCache.set(doc, cached);
  return cached;
}

function getEntityById(doc, coll, id) {
  const collMap = getDocIndex(doc).get(coll);
  return collMap ? collMap.get(id) ?? null : null;
}

function computeEntityBox(coll, entity, doc) {
  if (!entity) return null;
  if (coll === "tables") {
    const w = getTableWidth(entity);
    const h = getTableHeight(entity, false, doc?.relationships ?? []);
    return {
      x: Number(entity.x) || 0,
      y: Number(entity.y) || 0,
      w,
      h,
      label: entity.name || String(entity.id),
    };
  }
  if (coll === "areas") {
    return {
      x: Number(entity.x) || 0,
      y: Number(entity.y) || 0,
      w: Number(entity.width) || 240,
      h: Number(entity.height) || 160,
      label: entity.name || String(entity.id),
    };
  }
  if (coll === "notes") {
    return {
      x: Number(entity.x) || 0,
      y: Number(entity.y) || 0,
      w: Number(entity.width) || 240,
      h: Number(entity.height) || 110,
      label: entity.title || String(entity.id),
    };
  }
  if (coll === "views") {
    return {
      x: Number(entity.x) || 0,
      y: Number(entity.y) || 0,
      w: Number(entity.width) || 220,
      h: 48 + (entity.fields?.length ?? 2) * 36,
      label: entity.name || String(entity.id),
    };
  }
  if (coll === "relationships") {
    const startT = getEntityById(doc, "tables", entity.startTableId);
    const endT = getEntityById(doc, "tables", entity.endTableId);
    if (!startT && !endT) return null;
    const ax = Number(startT?.x ?? endT?.x) || 0;
    const ay = Number(startT?.y ?? endT?.y) || 0;
    const bx = Number(endT?.x ?? startT?.x) || 0;
    const by = Number(endT?.y ?? startT?.y) || 0;
    const minX = Math.min(ax, bx);
    const minY = Math.min(ay, by);
    return {
      x: minX,
      y: minY,
      w: Math.max(160, Math.abs(bx - ax) + 200),
      h: Math.max(80, Math.abs(by - ay) + 120),
      label: entity.name || String(entity.id),
    };
  }
  return null;
}

function overlapsBounds(box, bounds) {
  if (!bounds) return true;
  return (
    box.x <= bounds.right &&
    box.x + box.w >= bounds.left &&
    box.y <= bounds.bottom &&
    box.y + box.h >= bounds.top
  );
}

export function buildProposalMarkers(
  preview,
  { viewBox = null, zoom = 1 } = {},
) {
  const simplified = (Number(zoom) || 1) < SIMPLIFIED_TABLE_ZOOM;
  if (!preview?.proposal) {
    return { markers: [], ghosts: [], simplified };
  }

  const before = preview.before ?? {};
  const after = preview.after ?? {};
  const summaryItems = preview.proposal.summary?.items ?? [];
  const bounds = viewBox ? cullBounds(viewBox) : null;

  const markers = [];
  const ghosts = [];
  const seenKeys = new Set();

  for (const item of summaryItems) {
    const isSubItem = ["fields", "indices", "uniqueConstraints"].includes(
      item.coll,
    );
    const targetColl = isSubItem ? "tables" : item.coll;
    const targetId = isSubItem ? item.parentId ?? item.id : item.id;
    const targetChange = isSubItem ? "modified" : item.change;
    const dedupeKey = `${targetColl}:${targetId}:${targetChange}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    if (targetChange === "removed") {
      const entity = getEntityById(before, targetColl, targetId);
      const box = computeEntityBox(targetColl, entity, before);
      if (box && overlapsBounds(box, bounds)) {
        ghosts.push({
          key: dedupeKey,
          coll: targetColl,
          id: targetId,
          change: "removed",
          isGhost: true,
          label: item.beforeName || box.label,
          ...box,
        });
      }
    } else {
      const entity = getEntityById(after, targetColl, targetId);
      const box = computeEntityBox(targetColl, entity, after);
      if (box && overlapsBounds(box, bounds)) {
        markers.push({
          key: dedupeKey,
          coll: targetColl,
          id: targetId,
          change: targetChange,
          isGhost: false,
          label: item.afterName || item.beforeName || box.label,
          ...box,
        });
      }
    }
  }

  return { markers, ghosts, simplified };
}

export function locateProposalItem(
  item,
  preview,
  currentZoom = LOCATE_ZOOM,
) {
  if (!item || !preview) return null;
  const isSubItem = ["fields", "indices", "uniqueConstraints"].includes(
    item.coll,
  );
  const targetColl = isSubItem ? "tables" : item.coll;
  const targetId = isSubItem ? item.parentId ?? item.id : item.id;
  const sourceDoc =
    item.change === "removed" ? preview.before ?? {} : preview.after ?? {};
  const entity = getEntityById(sourceDoc, targetColl, targetId);
  const box = computeEntityBox(targetColl, entity, sourceDoc);
  const nextZoom =
    currentZoom < LOCATE_MIN_ZOOM ? LOCATE_ZOOM : currentZoom;

  if (!box) {
    return {
      pan: { x: 0, y: 0 },
      zoom: nextZoom,
      coll: targetColl,
      targetId,
    };
  }

  return {
    pan: {
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
    },
    zoom: nextZoom,
    coll: targetColl,
    targetId,
  };
}

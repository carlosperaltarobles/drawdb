/** Below this zoom, tables are drawn as lightweight boxes (see SimplifiedTable). */
export const SIMPLIFIED_TABLE_ZOOM = 0.35;

/**
 * The visible area grown by `margin` times its size on every side, so
 * elements are already drawn when they scroll into view. Null when the canvas
 * has no size yet, which disables culling.
 */
export function cullBounds(viewBox, margin = 0.5) {
  if (!(viewBox?.width > 0) || !(viewBox?.height > 0)) return null;
  const mx = viewBox.width * margin;
  const my = viewBox.height * margin;
  return {
    left: viewBox.left - mx,
    top: viewBox.top - my,
    right: viewBox.left + viewBox.width + mx,
    bottom: viewBox.top + viewBox.height + my,
  };
}

const overlaps = (box, bounds) =>
  box.x <= bounds.right &&
  box.x + box.w >= bounds.left &&
  box.y <= bounds.bottom &&
  box.y + box.h >= bounds.top;

/**
 * The tables and relationships worth rendering for the given bounds. Tables in
 * `keepTableIds` (selected, dragged...) and the relationship `keepRelationshipId`
 * are always kept so their editors and interactions survive panning away.
 *
 * @param {Map<string, {x:number, y:number, w:number, h:number}>} boxes table boxes by id
 */
export function cullElements({
  tables,
  relationships,
  boxes,
  bounds,
  keepTableIds = new Set(),
  keepRelationshipId = null,
}) {
  if (!bounds) return { tables, relationships };

  const visibleTables = tables.filter(
    (t) =>
      keepTableIds.has(t.id) ||
      !boxes.has(t.id) ||
      overlaps(boxes.get(t.id), bounds),
  );

  const visibleRelationships = relationships.filter((r) => {
    if (r.id === keepRelationshipId) return true;
    const a = boxes.get(r.startTableId);
    const b = boxes.get(r.endTableId);
    if (!a || !b) return true;
    // The line stays within the box that spans both tables.
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return overlaps(
      {
        x,
        y,
        w: Math.max(a.x + a.w, b.x + b.w) - x,
        h: Math.max(a.y + a.h, b.y + b.h) - y,
      },
      bounds,
    );
  });

  return { tables: visibleTables, relationships: visibleRelationships };
}

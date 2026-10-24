import { relatedTableIds } from "../utils/relatedTables";

export function computeFocusedIds(relationships = [], focus = null) {
  if (!focus) return null;
  const ids = relatedTableIds(relationships, focus.rootId, focus.depth);
  if (focus.extraIds) {
    for (const id of focus.extraIds) {
      ids.add(id);
    }
  }
  return ids;
}

export function resolveFocusAfterChange(
  tables = [],
  focus = null,
  relatedRootId = null,
) {
  const existingIds = new Set(tables.map((t) => t.id));

  let nextFocus = focus;
  let focusRootDeleted = false;

  if (focus) {
    if (!existingIds.has(focus.rootId)) {
      nextFocus = null;
      focusRootDeleted = true;
    } else if (focus.extraIds && focus.extraIds.size > 0) {
      const nextExtraIds = new Set();
      for (const id of focus.extraIds) {
        if (existingIds.has(id)) {
          nextExtraIds.add(id);
        }
      }
      if (nextExtraIds.size !== focus.extraIds.size) {
        nextFocus = { ...focus, extraIds: nextExtraIds };
      }
    }
  }

  let nextRelatedRootId = relatedRootId;
  let relatedRootDeleted = false;

  if (relatedRootId != null && !existingIds.has(relatedRootId)) {
    nextRelatedRootId = null;
    relatedRootDeleted = true;
  }

  return {
    focus: nextFocus,
    relatedRootId: nextRelatedRootId,
    focusRootDeleted,
    relatedRootDeleted,
  };
}

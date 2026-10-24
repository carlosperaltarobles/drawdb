export const FOCUS_DEPTHS = [1, 2, 3, Infinity];
export const DIMMED_OPACITY = 0.2;

export function relatedTableIds(relationships = [], rootId, depth = 1) {
  if (rootId == null) return new Set();

  const adjacency = new Map();
  for (const rel of relationships) {
    const start = rel?.startTableId;
    const end = rel?.endTableId;
    if (start == null || end == null) continue;

    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start).add(end);
    adjacency.get(end).add(start);
  }

  const visited = new Set([rootId]);
  let frontier = [rootId];
  let hops = 0;

  while (frontier.length > 0 && hops < depth) {
    const nextFrontier = [];
    for (const current of frontier) {
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
    hops += 1;
  }

  return visited;
}

export function relatedSubgraph(
  tables = [],
  relationships = [],
  rootId,
  depth = 1,
) {
  const existingTableIds = new Set(tables.map((t) => t.id));
  const validRelationships = relationships.filter(
    (r) =>
      existingTableIds.has(r?.startTableId) &&
      existingTableIds.has(r?.endTableId),
  );
  const ids = relatedTableIds(validRelationships, rootId, depth);
  const filteredTables = tables.filter((t) => ids.has(t.id));
  const filteredIds = new Set(filteredTables.map((t) => t.id));
  const filteredRelationships = validRelationships.filter(
    (r) => filteredIds.has(r.startTableId) && filteredIds.has(r.endTableId),
  );

  return {
    tables: filteredTables,
    relationships: filteredRelationships,
  };
}

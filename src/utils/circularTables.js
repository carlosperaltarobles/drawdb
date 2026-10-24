const GRAY = 1;
const BLACK = 2;

export function findCircularTableIds(tables = [], relationships = []) {
  const validTableIds = new Set();
  for (const table of tables) {
    if (table && table.id != null) {
      validTableIds.add(table.id);
    }
  }

  const adjacency = new Map();
  for (const rel of relationships) {
    const startId = rel?.startTableId;
    const endId = rel?.endTableId;
    if (startId === endId) continue;
    if (!validTableIds.has(startId) || !validTableIds.has(endId)) continue;

    let targets = adjacency.get(startId);
    if (!targets) {
      targets = [];
      adjacency.set(startId, targets);
    }
    targets.push(endId);
  }

  const state = new Map();
  const reported = new Set();
  const result = [];

  for (const table of tables) {
    const rootId = table?.id;
    if (!validTableIds.has(rootId) || state.has(rootId)) continue;

    state.set(rootId, GRAY);
    const stack = [[rootId, 0]];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const currentId = frame[0];
      const edges = adjacency.get(currentId);

      if (!edges || frame[1] >= edges.length) {
        state.set(currentId, BLACK);
        stack.pop();
        continue;
      }

      const targetId = edges[frame[1]];
      frame[1] += 1;

      const targetState = state.get(targetId);
      if (targetState === GRAY) {
        if (!reported.has(targetId)) {
          reported.add(targetId);
          result.push(targetId);
        }
      } else if (targetState === undefined) {
        state.set(targetId, GRAY);
        stack.push([targetId, 0]);
      }
    }
  }

  return result;
}

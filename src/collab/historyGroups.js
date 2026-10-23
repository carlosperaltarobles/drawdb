import { DateTime } from "luxon";

function toLocalDateTime(value) {
  if (DateTime.isDateTime(value)) return value.toLocal();
  if (value instanceof Date) return DateTime.fromJSDate(value).toLocal();
  return DateTime.fromISO(String(value)).toLocal();
}

export function groupHistory(items = [], now = new Date()) {
  if (!items.length) return [];

  const todayStart = toLocalDateTime(now).startOf("day");
  const yesterdayStart = todayStart.minus({ days: 1 });
  const weekStart = todayStart.minus({ days: 6 });

  const groupsById = new Map();

  for (const item of items) {
    const dt = toLocalDateTime(item.createdAt);
    const dayStart = dt.startOf("day");

    let key;
    let label;
    let groupId;

    if (dayStart >= todayStart) {
      key = "today";
      groupId = key;
    } else if (dayStart >= yesterdayStart) {
      key = "yesterday";
      groupId = key;
    } else if (dayStart >= weekStart) {
      key = "this_week";
      groupId = key;
    } else {
      key = "older";
      label = dt.toFormat("yyyy-MM-dd");
      groupId = `older:${label}`;
    }

    let group = groupsById.get(groupId);
    if (!group) {
      group =
        label !== undefined ? { key, label, items: [] } : { key, items: [] };
      groupsById.set(groupId, group);
    }
    group.items.push(item);
  }

  return Array.from(groupsById.values());
}

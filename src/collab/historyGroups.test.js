import { describe, expect, it } from "vitest";
import { groupHistory } from "./historyGroups";

describe("groupHistory", () => {
  const now = new Date(2026, 9, 23, 15, 0, 0);
  const localIso = (day, hour, minute = 0) =>
    new Date(2026, 9, day, hour, minute, 0).toISOString();

  it("devuelve una lista vacía cuando no hay elementos", () => {
    expect(groupHistory([], now)).toEqual([]);
  });

  it("agrupa en today, yesterday, this_week y older por fecha local conservando el orden", () => {
    const todayItem = { id: "1", createdAt: localIso(23, 9, 0) };
    const yesterdayItem = { id: "2", createdAt: localIso(22, 18, 30) };
    const thisWeekItem = { id: "3", createdAt: localIso(19, 12, 0) };
    const olderItem1 = { id: "4", createdAt: localIso(10, 16, 0) };
    const olderItem2 = { id: "5", createdAt: localIso(10, 8, 15) };
    const olderOtherDay = { id: "6", createdAt: localIso(8, 11, 0) };

    const groups = groupHistory(
      [
        todayItem,
        yesterdayItem,
        thisWeekItem,
        olderItem1,
        olderItem2,
        olderOtherDay,
      ],
      now,
    );

    expect(groups).toEqual([
      { key: "today", items: [todayItem] },
      { key: "yesterday", items: [yesterdayItem] },
      { key: "this_week", items: [thisWeekItem] },
      {
        key: "older",
        label: "2026-10-10",
        items: [olderItem1, olderItem2],
      },
      {
        key: "older",
        label: "2026-10-08",
        items: [olderOtherDay],
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { radialLayout } from "./radialLayout";
import { getTableHeight, getTableWidth } from "./utils";

const field = (id) => ({ id, name: `f${id}`, type: "INT" });
const table = (id, x = 0, y = 0, fieldCount = 3) => ({
  id,
  name: `t${id}`,
  x,
  y,
  fields: Array.from({ length: fieldCount }, (_, i) => field(i)),
});
const rel = (id, startTableId, endTableId) => ({
  id,
  startTableId,
  endTableId,
  startFieldId: 0,
  endFieldId: 0,
});

const center = (t, rels) => ({
  x: t.x + getTableWidth(t) / 2,
  y: t.y + getTableHeight(t, false, rels) / 2,
});
const box = (t, rels) => ({
  left: t.x,
  top: t.y,
  right: t.x + getTableWidth(t),
  bottom: t.y + getTableHeight(t, false, rels),
});
const overlaps = (a, b) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("radialLayout", () => {
  it("centra la tabla principal en el origen", () => {
    const tables = [table(1, 5000, 5000)];
    const [root] = radialLayout(tables, [], 1, false);
    const c = center(root, []);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
  });

  it("no cambia nada más que x e y, ni el orden", () => {
    const tables = [table(2, 900, 900), table(1, -900, 40)];
    const rels = [rel(1, 1, 2)];
    const out = radialLayout(tables, rels, 1, false);
    expect(out.map((t) => t.id)).toEqual([2, 1]);
    expect(out[0]).toEqual({ ...tables[0], x: out[0].x, y: out[0].y });
    expect(tables[0].x).toBe(900);
  });

  it("los anillos se alejan del centro según los saltos", () => {
    const tables = [table(1), table(2), table(3)];
    const rels = [rel(1, 1, 2), rel(2, 2, 3)];
    const out = radialLayout(tables, rels, 1, false);
    const dist = (t) => Math.hypot(center(t, rels).x, center(t, rels).y);
    expect(dist(out[1])).toBeGreaterThan(0);
    expect(dist(out[2])).toBeGreaterThan(dist(out[1]));
  });

  it("ninguna tabla se encima con otra", () => {
    const tables = Array.from({ length: 25 }, (_, i) =>
      table(i + 1, i * 37, i * 11, 2 + (i % 6)),
    );
    const rels = tables
      .slice(1)
      .map((t, i) => rel(i + 1, i < 8 ? 1 : (i % 8) + 2, t.id));
    const out = radialLayout(tables, rels, 1, false);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(overlaps(box(out[i], rels), box(out[j], rels))).toBe(false);
      }
    }
  });

  it("queda compacto: el anillo 1 con 6 tablas no se aleja de más", () => {
    const tables = Array.from({ length: 7 }, (_, i) => table(i + 1));
    const rels = tables.slice(1).map((t, i) => rel(i + 1, 1, t.id));
    const out = radialLayout(tables, rels, 1, false);
    const w = getTableWidth(tables[0]);
    for (const t of out.slice(1)) {
      const c = center(t, rels);
      expect(Math.hypot(c.x, c.y)).toBeLessThan(w * 3);
    }
  });

  it("es determinista", () => {
    const tables = [table(1), table(2), table(3), table(4)];
    const rels = [rel(1, 1, 2), rel(2, 3, 1), rel(3, 2, 4)];
    expect(radialLayout(tables, rels, 1, false)).toEqual(
      radialLayout(tables, rels, 1, false),
    );
  });

  it("tolera tablas sin conexión y un rootId inexistente", () => {
    const tables = [table(1), table(2)];
    expect(() => radialLayout(tables, [], 1, false)).not.toThrow();
    expect(radialLayout(tables, [], 99, false)).toHaveLength(2);
  });
});

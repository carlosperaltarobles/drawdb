import { describe, expect, it } from "vitest";
import { autoArrange } from "./autoArrange";

const table = (id, extra = {}) => ({ id, x: 0, y: 0, fields: [], ...extra });
const rel = (startTableId, endTableId) => ({ startTableId, endTableId });
const settings = { showComments: false };

const byId = (positions) => new Map(positions.map((p) => [p.id, p]));

const overlaps = (positions, size = 200) =>
  positions.some((a, i) =>
    positions.some(
      (b, j) =>
        i < j && Math.abs(a.x - b.x) < size * 0.9 && Math.abs(a.y - b.y) < 40,
    ),
  );

describe("autoArrange", () => {
  const chain = [table("a"), table("b"), table("c")];
  const chainRels = [rel("a", "b"), rel("b", "c")];

  it("horizontal places related tables left to right", () => {
    const p = byId(autoArrange(chain, chainRels, settings, "horizontal"));
    expect(p.get("a").x).toBeLessThan(p.get("b").x);
    expect(p.get("b").x).toBeLessThan(p.get("c").x);
  });

  it("vertical places related tables top to bottom", () => {
    const p = byId(autoArrange(chain, chainRels, settings, "vertical"));
    expect(p.get("a").y).toBeLessThan(p.get("b").y);
    expect(p.get("b").y).toBeLessThan(p.get("c").y);
  });

  it("defaults to horizontal", () => {
    expect(autoArrange(chain, chainRels, settings)).toEqual(
      autoArrange(chain, chainRels, settings, "horizontal"),
    );
  });

  it("never moves locked tables", () => {
    const tables = [...chain, table("z", { locked: true })];
    for (const mode of ["horizontal", "vertical", "groups"]) {
      const ids = autoArrange(tables, chainRels, settings, mode).map(
        (p) => p.id,
      );
      expect(ids).not.toContain("z");
      expect(ids.sort()).toEqual(["a", "b", "c"]);
    }
  });

  describe("groups", () => {
    // "hub" links to 10 tables; two independent blocks hang from it.
    const leaves = Array.from({ length: 6 }, (_, i) => `leaf${i}`);
    const tables = [
      table("hub"),
      table("sale"),
      table("sale_line"),
      table("invoice"),
      table("stock"),
      table("stock_move"),
      ...leaves.map((id) => table(id)),
      table("alone"),
    ];
    const relationships = [
      rel("sale_line", "sale"),
      rel("invoice", "sale"),
      rel("stock_move", "stock"),
      ...["sale", "sale_line", "invoice", "stock"].map((id) => rel(id, "hub")),
      ...leaves.map((id) => rel(id, "hub")),
    ];

    const positions = autoArrange(tables, relationships, settings, "groups");
    const p = byId(positions);

    it("places every movable table once without overlaps", () => {
      expect(positions).toHaveLength(tables.length);
      expect(overlaps(positions)).toBe(false);
    });

    it("puts the central table above everything else", () => {
      for (const t of tables) {
        if (t.id !== "hub") expect(p.get("hub").y).toBeLessThan(p.get(t.id).y);
      }
    });

    it("keeps each block together, apart from the other", () => {
      const spread = (ids) => {
        const xs = ids.map((id) => p.get(id).x);
        const ys = ids.map((id) => p.get(id).y);
        return {
          left: Math.min(...xs),
          right: Math.max(...xs) + 200,
          top: Math.min(...ys),
          bottom: Math.max(...ys) + 40,
        };
      };
      const sales = spread(["sale", "sale_line", "invoice"]);
      const stock = spread(["stock", "stock_move"]);
      const apart =
        sales.right <= stock.left ||
        stock.right <= sales.left ||
        sales.bottom <= stock.top ||
        stock.bottom <= sales.top;
      expect(apart).toBe(true);
    });

    it("works when no table is central", () => {
      const result = autoArrange(chain, chainRels, settings, "groups");
      expect(result).toHaveLength(3);
      expect(overlaps(result)).toBe(false);
    });
  });
});

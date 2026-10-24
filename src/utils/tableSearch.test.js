import { describe, expect, it } from "vitest";
import {
  buildSearchOptions,
  filterSearchOptions,
  normalizeSearch,
} from "./tableSearch";

const sampleTables = [
  {
    id: "t1",
    name: "pedidos",
    fields: [
      { id: "f1", name: "id" },
      { id: "f2", name: "total" },
    ],
  },
  {
    id: "t2",
    name: "pagos",
    fields: [{ id: "f1", name: "id" }],
  },
];

describe("tableSearch", () => {
  it("column options have unique values even with repeated names", () => {
    const options = buildSearchOptions(sampleTables, "columns");
    const idOptions = options.filter((o) => o.label.endsWith(".id"));
    expect(idOptions).toHaveLength(2);
    expect(idOptions.map((o) => o.label)).toEqual(["pedidos.id", "pagos.id"]);
    expect(idOptions[0].value).not.toBe(idOptions[1].value);
    expect(idOptions[0]).toMatchObject({
      kind: "column",
      tableId: "t1",
      fieldIndex: 0,
    });
    expect(idOptions[1]).toMatchObject({
      kind: "column",
      tableId: "t2",
      fieldIndex: 0,
    });
  });

  it("both lists tables before columns", () => {
    const options = buildSearchOptions(sampleTables, "both");
    const kinds = options.map((o) => o.kind);
    const firstColumnIdx = kinds.indexOf("column");
    expect(firstColumnIdx).toBeGreaterThan(0);
    expect(kinds.slice(0, firstColumnIdx).every((k) => k === "table")).toBe(
      true,
    );
    expect(kinds.slice(firstColumnIdx).every((k) => k === "column")).toBe(true);
  });

  it("tables mode has no columns", () => {
    const options = buildSearchOptions(sampleTables, "tables");
    expect(options).toHaveLength(2);
    expect(options.every((o) => o.kind === "table")).toBe(true);
    expect(options[0]).toMatchObject({
      value: "t:t1",
      kind: "table",
      label: "pedidos",
      tableId: "t1",
    });
  });

  it("filter ignores case and accents", () => {
    const options = [
      { value: "t:1", kind: "table", label: "Categoría", tableId: "1" },
      { value: "t:2", kind: "table", label: "Productos", tableId: "2" },
    ];
    expect(normalizeSearch("Categoría")).toBe("categoria");
    expect(filterSearchOptions(options, "categoria")).toHaveLength(1);
    expect(filterSearchOptions(options, "CATEG")).toHaveLength(1);
  });

  it("filter matches substrings", () => {
    const options = [
      { value: "t:1", kind: "table", label: "detalle_pedido", tableId: "1" },
      { value: "t:2", kind: "table", label: "usuarios", tableId: "2" },
    ];
    const filtered = filterSearchOptions(options, "ped");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe("detalle_pedido");
  });

  it("empty query returns all", () => {
    const options = buildSearchOptions(sampleTables, "both");
    expect(filterSearchOptions(options, "")).toEqual(options);
    expect(filterSearchOptions(options, "   ")).toEqual(options);
  });
  it("column mode matches the column name, not the table name", () => {
    const tables = [
      { id: "1", name: "pedidos", fields: [{ id: "a", name: "id" }] },
      { id: "2", name: "pagos", fields: [{ id: "b", name: "pedido_id" }] },
    ];
    const filtered = filterSearchOptions(
      buildSearchOptions(tables, "columns"),
      "ped",
    );
    expect(filtered.map((o) => o.label)).toEqual(["pagos.pedido_id"]);
  });
});

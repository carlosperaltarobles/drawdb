export function normalizeSearch(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function buildSearchOptions(tables = [], mode = "tables") {
  const tableOptions =
    mode === "tables" || mode === "both"
      ? tables.map((table) => ({
          value: `t:${table.id}`,
          kind: "table",
          label: table.name,
          tableId: table.id,
        }))
      : [];

  const columnOptions =
    mode === "columns" || mode === "both"
      ? tables.flatMap((table) =>
          (table.fields ?? []).map((field, fieldIndex) => ({
            value: `c:${table.id}:${field.id ?? fieldIndex}`,
            kind: "column",
            label: `${table.name}.${field.name}`,
            tableId: table.id,
            fieldIndex,
          })),
        )
      : [];

  return [...tableOptions, ...columnOptions];
}

export function filterSearchOptions(options = [], query = "") {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return options;
  const normalizedQuery = normalizeSearch(trimmed);
  return options.filter((option) =>
    normalizeSearch(option.label).includes(normalizedQuery),
  );
}

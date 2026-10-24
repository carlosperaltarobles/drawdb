import { useMemo, useState } from "react";
import { useSelect } from "../../../hooks";
import { AutoComplete, Select, Tag } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { ObjectType } from "../../../data/constants";
import { useTranslation } from "react-i18next";
import {
  buildSearchOptions,
  filterSearchOptions,
} from "../../../utils/tableSearch";

// Big diagrams have thousands of columns; the dropdown is not virtualized.
const MAX_RESULTS = 100;

export default function SearchBar({ tables }) {
  const { setSelectedElement } = useSelect();
  const { t } = useTranslation();
  const [mode, setMode] = useState("tables");
  const [query, setQuery] = useState("");

  const options = useMemo(
    () => buildSearchOptions(tables, mode),
    [tables, mode],
  );

  const filteredOptions = useMemo(
    () => filterSearchOptions(options, query).slice(0, MAX_RESULTS),
    [options, query],
  );

  const modeOptions = useMemo(
    () => [
      { value: "tables", label: t("search_mode_tables") },
      { value: "columns", label: t("search_mode_columns") },
      { value: "both", label: t("search_mode_both") },
    ],
    [t],
  );

  const handleSelect = (selected) => {
    const selectedValue =
      typeof selected === "object" && selected !== null
        ? selected.value
        : selected;
    const option = options.find((item) => item.value === selectedValue);
    if (!option) return;

    const { tableId, kind, fieldIndex } = option;

    setSelectedElement((prev) => ({
      ...prev,
      id: tableId,
      open: true,
      element: ObjectType.TABLE,
    }));
    document
      .getElementById(`scroll_table_${tableId}`)
      ?.scrollIntoView({ behavior: "smooth" });

    if (kind === "column") {
      requestAnimationFrame(() => {
        document
          .getElementById(`scroll_table_${tableId}_input_${fieldIndex}`)
          ?.focus();
      });
    }

    setQuery("");
  };

  return (
    <div className="flex items-center gap-1.5 w-full min-w-0">
      <AutoComplete
        data={filteredOptions}
        value={query}
        showClear
        prefix={<IconSearch />}
        placeholder={t("search")}
        dropdownStyle={{ maxHeight: 400, overflow: "auto" }}
        emptyContent={
          <div className="p-3 popover-theme">{t("not_found")}</div>
        }
        renderItem={(option) => (
          <div className="flex items-center justify-between gap-2 w-full">
            <span className="truncate">{option.label}</span>
            <Tag
              size="small"
              color={option.kind === "table" ? "blue" : "amber"}
              className="shrink-0"
            >
              {t(
                option.kind === "table"
                  ? "search_kind_table"
                  : "search_kind_column",
              )}
            </Tag>
          </div>
        )}
        onSearch={(v) => setQuery(v)}
        onClear={() => setQuery("")}
        onSelect={handleSelect}
        className="w-full min-w-0 flex-1"
      />
      <Select
        value={mode}
        onChange={(v) => setMode(v)}
        optionList={modeOptions}
        aria-label={t("search")}
        className="shrink-0"
      />
    </div>
  );
}


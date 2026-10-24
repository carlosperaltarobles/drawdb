import { memo, useCallback, useRef } from "react";
import { Collapse, Button } from "@douyinfe/semi-ui";
import {
  IconEyeOpened,
  IconEyeClosed,
  IconPlus,
  IconMapPinStroked,
  IconBranch,
  IconFilter,
} from "@douyinfe/semi-icons";
import {
  useSelect,
  useDiagram,
  useSaveState,
  useLayout,
  useUndoRedo,
  useSettings,
  useFocus,
} from "../../../hooks";
import useLocateTable from "../../../hooks/useLocateTable";
import useLayoutStable from "../../../hooks/useLayoutStable";
import { Action, ObjectType, State } from "../../../data/constants";
import { sameIgnoringLayout } from "../../../utils/layoutFields";
import { useTranslation } from "react-i18next";
import { DragHandle } from "../../SortableList/DragHandle";
import { SortableList } from "../../SortableList/SortableList";
import SearchBar from "./SearchBar";
import Empty from "../Empty";
import TableInfo from "./TableInfo";

const noop = () => {};

const TablesList = memo(function TablesList({
  tables,
  activeKey,
  onActiveChange,
  onReorder,
  renderItem,
}) {
  return (
    <Collapse
      activeKey={activeKey}
      keepDOM={false}
      lazyRender
      onChange={onActiveChange}
      accordion
    >
      <SortableList
        keyPrefix="tables-tab"
        items={tables}
        isItemEqual={sameIgnoringLayout}
        onChange={onReorder}
        afterChange={noop}
        renderItem={renderItem}
      />
    </Collapse>
  );
});

export default function TablesTab() {
  const { tables, addTable, updateTable, setTables } = useDiagram();
  const { selectedElement, setSelectedElement } = useSelect();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { includeTable, openRelated, startFocus } = useFocus();
  const locate = useLocateTable();
  const { t } = useTranslation();
  const { layout } = useLayout();
  const { setSaveState } = useSaveState();
  const stableTables = useLayoutStable(tables);

  const actionsRef = useRef(null);
  actionsRef.current = {
    updateTable,
    setUndoStack,
    setRedoStack,
    openRelated,
    startFocus,
    locate,
    t,
  };

  const onToggleHidden = useCallback((table) => {
    const { updateTable, setUndoStack, setRedoStack, t } = actionsRef.current;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.TABLE,
        component: "self",
        tid: table.id,
        undo: { hidden: table.hidden },
        redo: { hidden: !table.hidden },
        message: t("edit_table", {
          tableName: table.name,
          extra: "[hidden]",
        }),
      },
    ]);
    setRedoStack([]);
    updateTable(table.id, { hidden: !table.hidden });
  }, []);

  const onLocate = useCallback((id) => {
    actionsRef.current.locate(id);
  }, []);

  const onOpenRelated = useCallback((id) => {
    actionsRef.current.openRelated(id);
  }, []);

  const onFocus = useCallback((id) => {
    actionsRef.current.startFocus(id, 1);
  }, []);

  const renderItem = useCallback(
    (item) => (
      <TableListItem
        table={item}
        onToggleHidden={onToggleHidden}
        onLocate={onLocate}
        onOpenRelated={onOpenRelated}
        onFocus={onFocus}
      />
    ),
    [onToggleHidden, onLocate, onOpenRelated, onFocus],
  );

  const onActiveChange = useCallback(
    (k) =>
      setSelectedElement((prev) => ({
        ...prev,
        open: true,
        id: k[0],
        element: ObjectType.TABLE,
      })),
    [setSelectedElement],
  );

  const onReorder = useCallback(
    (newItems) => {
      const ids = newItems.map((item) => item.id);
      setTables((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t]));
        return ids.map((id) => byId.get(id));
      });
      setSaveState(State.SAVING);
    },
    [setTables, setSaveState],
  );

  const activeKey =
    selectedElement.open && selectedElement.element === ObjectType.TABLE
      ? `${selectedElement.id}`
      : "";

  return (
    <>
      <div className="flex gap-2">
        <SearchBar tables={stableTables} />
        <div>
          <Button
            block
            icon={<IconPlus />}
            onClick={() => {
              const id = addTable();
              includeTable(id);
            }}
            disabled={layout.readOnly}
          >
            {t("add_table")}
          </Button>
        </div>
      </div>
      {tables.length === 0 ? (
        <Empty title={t("no_tables")} text={t("no_tables_text")} />
      ) : (
        <TablesList
          tables={stableTables}
          activeKey={activeKey}
          onActiveChange={onActiveChange}
          onReorder={onReorder}
          renderItem={renderItem}
        />
      )}
    </>
  );
}

function TableListItem({
  table,
  onToggleHidden,
  onLocate,
  onOpenRelated,
  onFocus,
}) {
  const { layout } = useLayout();
  const { settings } = useSettings();
  const { t } = useTranslation();

  const toggleTableVisibility = (e) => {
    e.stopPropagation();
    onToggleHidden(table);
  };

  return (
    <div id={`scroll_table_${table.id}`}>
      <Collapse.Panel
        className="relative"
        header={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <DragHandle readOnly={layout.readOnly} id={table.id} />
              <div className="overflow-hidden text-ellipsis whitespace-nowrap shrink-0 max-w-[60%]">
                {table.name}
              </div>
              {settings.showComments && table.comment && (
                <div
                  className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0 flex-1 text-xs font-normal opacity-60"
                  title={table.comment}
                >
                  {table.comment}
                </div>
              )}
            </div>
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              disabled={Boolean(table.hidden)}
              title={
                table.hidden ? t("locate_hidden_table") : t("locate_in_diagram")
              }
              aria-label={t("locate_in_diagram")}
              onClick={(e) => {
                e.stopPropagation();
                onLocate(table.id);
              }}
              icon={<IconMapPinStroked />}
            />
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              title={t("view_related")}
              aria-label={t("view_related")}
              onClick={(e) => {
                e.stopPropagation();
                onOpenRelated(table.id);
              }}
              icon={<IconBranch />}
            />
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              title={t("focus_on_canvas")}
              aria-label={t("focus_on_canvas")}
              onClick={(e) => {
                e.stopPropagation();
                onFocus(table.id);
              }}
              icon={<IconFilter />}
            />
            <Button
              size="small"
              theme="borderless"
              type="tertiary"
              onClick={toggleTableVisibility}
              icon={table.hidden ? <IconEyeClosed /> : <IconEyeOpened />}
              className="me-2"
            />
            <div
              className="w-1 h-full absolute top-0 left-0 bottom-0"
              style={{ backgroundColor: table.color }}
            />
          </div>
        }
        itemKey={`${table.id}`}
      >
        <TableInfo data={table} />
      </Collapse.Panel>
    </div>
  );
}

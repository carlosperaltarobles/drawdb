import { useCallback } from "react";
import { Button, Modal } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { ObjectType } from "../data/constants";
import { locateTransform } from "../utils/locate";
import {
  useDiagram,
  useFocus,
  useSelect,
  useSettings,
  useTransform,
} from ".";

export default function useLocateTable() {
  const { t } = useTranslation();
  const { tables, relationships } = useDiagram();
  const { setTransform } = useTransform();
  const { setSelectedElement } = useSelect();
  const { settings } = useSettings();
  const { isTableDimmed, includeTable, exitFocus, flashTable } =
    useFocus() ?? {};

  const performLocate = useCallback(
    (table) => {
      setTransform((prev) => ({
        ...prev,
        ...locateTransform(
          table,
          prev.zoom,
          settings.showComments,
          relationships,
        ),
      }));
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.TABLE,
        id: table.id,
      }));
      flashTable?.(table.id);
    },
    [
      setTransform,
      settings.showComments,
      relationships,
      setSelectedElement,
      flashTable,
    ],
  );

  return useCallback(
    (id) => {
      const table = tables.find((tbl) => tbl.id === id);
      if (!table || table.hidden) return;

      if (isTableDimmed?.(id)) {
        const modal = Modal.confirm({
          title: t("locate_outside_focus_title"),
          content: t("locate_outside_focus_text", { name: table.name }),
          footer: (
            <div className="flex justify-end gap-2">
              <Button
                type="tertiary"
                onClick={() => {
                  modal.destroy();
                }}
              >
                {t("cancel")}
              </Button>
              <Button
                type="secondary"
                onClick={() => {
                  exitFocus?.();
                  performLocate(table);
                  modal.destroy();
                }}
              >
                {t("locate_exit_focus")}
              </Button>
              <Button
                theme="solid"
                type="primary"
                onClick={() => {
                  includeTable?.(id);
                  performLocate(table);
                  modal.destroy();
                }}
              >
                {t("locate_add_to_focus")}
              </Button>
            </div>
          ),
        });
        return;
      }

      performLocate(table);
    },
    [tables, isTableDimmed, t, exitFocus, includeTable, performLocate],
  );
}

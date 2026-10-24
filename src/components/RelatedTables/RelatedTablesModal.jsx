import { useMemo, useState } from "react";
import { Button, ButtonGroup, Modal, Tag } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { useDiagram, useSettings } from "../../hooks";
import { FOCUS_DEPTHS, relatedSubgraph } from "../../utils/relatedTables";
import RelatedDiagram from "./RelatedDiagram";

export function RelatedTablesModal({ rootId, onClose, onFocus }) {
  const { t } = useTranslation();
  const diagram = useDiagram();
  const { settings } = useSettings();

  const tables = useMemo(() => diagram?.tables ?? [], [diagram?.tables]);
  const relationships = useMemo(
    () => diagram?.relationships ?? [],
    [diagram?.relationships],
  );

  const [depth, setDepth] = useState(1);
  const [prevRootId, setPrevRootId] = useState(rootId);
  if (prevRootId !== rootId) {
    setPrevRootId(rootId);
    setDepth(1);
  }

  const rootTable = useMemo(
    () =>
      rootId != null ? tables.find((tbl) => tbl.id === rootId) ?? null : null,
    [tables, rootId],
  );

  const subgraph = useMemo(
    () =>
      rootTable
        ? relatedSubgraph(tables, relationships, rootId, depth)
        : { tables: [], relationships: [] },
    [tables, relationships, rootId, rootTable, depth],
  );

  if (!rootId || !rootTable) return null;

  const title = t("related_title", { name: rootTable.name });
  const hasNoRelationships = subgraph.tables.length <= 1;

  return (
    <Modal
      visible
      centered
      closable
      onCancel={onClose}
      footer={null}
      width="80vw"
      title={title}
      bodyStyle={{
        height: "65vh",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("related_scope")}:</span>
          <ButtonGroup size="small">
            {FOCUS_DEPTHS.map((d) => {
              const label = Number.isFinite(d)
                ? t("related_depth_hops", { count: d })
                : t("related_depth_all");
              const active = depth === d;
              return (
                <Button
                  key={String(d)}
                  size="small"
                  theme={active ? "solid" : "light"}
                  type={active ? "primary" : "tertiary"}
                  aria-pressed={active}
                  onClick={() => setDepth(d)}
                >
                  {label}
                </Button>
              );
            })}
          </ButtonGroup>
          <Tag size="small" color="grey">
            {t("related_table_count", { count: subgraph.tables.length })}
          </Tag>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small"
            theme="solid"
            type="primary"
            onClick={() => onFocus?.(rootId, depth)}
          >
            {t("related_focus_to_edit")}
          </Button>
          <Button
            size="small"
            type="tertiary"
            onClick={onClose}
            aria-label={t("close")}
          >
            {t("close")}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        <RelatedDiagram
          tables={subgraph.tables}
          relationships={subgraph.relationships}
          rootId={rootId}
          showComments={settings?.showComments}
        />
      </div>

      {hasNoRelationships && (
        <div className="text-center text-sm text-zinc-500">
          {t("related_no_relationships")}
        </div>
      )}
    </Modal>
  );
}

export default RelatedTablesModal;

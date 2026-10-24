import { useMemo, useState } from "react";
import { Button, ButtonGroup, Modal, Tag } from "@douyinfe/semi-ui";
import { IconMaximize, IconMinimize } from "@douyinfe/semi-icons";
import { useTranslation } from "react-i18next";
import { useDiagram, useSettings } from "../../hooks";
import { FOCUS_DEPTHS, relatedSubgraph } from "../../utils/relatedTables";
import { radialLayout } from "../../utils/radialLayout";
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
  const [fullScreen, setFullScreen] = useState(false);
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

  const arrangedTables = useMemo(
    () =>
      radialLayout(
        subgraph.tables,
        subgraph.relationships,
        rootId,
        settings?.showComments,
      ),
    [subgraph, rootId, settings?.showComments],
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
      fullScreen={fullScreen}
      title={title}
      bodyStyle={{
        height: fullScreen ? "calc(100vh - 90px)" : "65vh",
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
            type="tertiary"
            icon={fullScreen ? <IconMinimize /> : <IconMaximize />}
            onClick={() => setFullScreen((v) => !v)}
            aria-pressed={fullScreen}
            aria-label={
              fullScreen
                ? t("related_exit_fullscreen")
                : t("related_fullscreen")
            }
          >
            {fullScreen
              ? t("related_exit_fullscreen")
              : t("related_fullscreen")}
          </Button>
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
          tables={arrangedTables}
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

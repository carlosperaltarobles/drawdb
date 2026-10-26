import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Input, Modal, Spin, Toast } from "@douyinfe/semi-ui";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { errorCode } from "../api/http";
import * as history from "../api/history";
import { groupHistory } from "./historyGroups";
import { useProjectCollab } from "./ProjectCollabProvider";

function formatHour(value) {
  if (!value) return "";
  const dt =
    value instanceof Date
      ? DateTime.fromJSDate(value).toLocal()
      : DateTime.fromISO(String(value)).toLocal();
  return dt.isValid ? dt.toFormat("HH:mm") : "";
}

function formatAuthors(item) {
  if (Array.isArray(item.authors) && item.authors.length > 0) {
    return item.authors
      .map((a) => a?.name)
      .filter(Boolean)
      .join(", ");
  }
  return item.createdBy?.name ?? "";
}

function groupTitle(group, t) {
  switch (group.key) {
    case "today":
      return t("today");
    case "yesterday":
      return t("yesterday");
    case "this_week":
      return t("history_this_week");
    default:
      return group.label ?? "";
  }
}

export default function HistoryPanel({ initialItems = [] }) {
  const {
    projectId,
    role,
    peers = [],
    preview,
    previewSnapshot,
    endPreview,
    lastRestoredAt,
  } = useProjectCollab() ?? {};
  const { t } = useTranslation();

  const canEdit = role === "admin" || role === "editor";
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [versionName, setVersionName] = useState("");
  const [savingModal, setSavingModal] = useState(false);

  const loadFirstPage = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await history.list(projectId);
      setItems(res?.items ?? []);
      setNextCursor(res?.nextCursor ?? null);
    } catch {
      // Keep current items if request fails
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage, lastRestoredAt]);

  const loadMore = async () => {
    if (!projectId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await history.list(projectId, nextCursor);
      setItems((prev) => [...prev, ...(res?.items ?? [])]);
      setNextCursor(res?.nextCursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  };

  const openCreateModal = () => {
    setVersionName("");
    setDialog({ mode: "create" });
  };

  const openRenameModal = (item) => {
    setVersionName(item.name ?? "");
    setDialog({ mode: "rename", item });
  };

  const closeModal = () => {
    if (savingModal) return;
    setDialog(null);
    setVersionName("");
  };

  const handleModalOk = async () => {
    const trimmed = versionName.trim().slice(0, 80);
    if (!trimmed || !projectId || savingModal) return;
    setSavingModal(true);
    try {
      if (dialog?.mode === "create") {
        await history.createNamed(projectId, trimmed);
      } else if (dialog?.mode === "rename" && dialog.item) {
        await history.rename(projectId, dialog.item.id, trimmed);
      }
      setDialog(null);
      setVersionName("");
      await loadFirstPage();
    } catch (err) {
      if (errorCode(err) === "snapshot_limit") {
        Toast.error(t("history_named_limit"));
      } else {
        Toast.error(t("something_went_wrong"));
      }
    } finally {
      setSavingModal(false);
    }
  };

  const confirmDelete = (item) => {
    Modal.confirm({
      title: t("delete"),
      content: t("history_delete_confirm"),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { type: "danger" },
      onOk: async () => {
        await history.remove(projectId, item.id);
        await loadFirstPage();
      },
    });
  };

  const groups = useMemo(() => groupHistory(items), [items]);
  const peerNames = useMemo(
    () =>
      peers
        .map((p) => p?.name)
        .filter(Boolean)
        .join(", "),
    [peers],
  );
  const trimmedName = versionName.trim();

  return (
    <div className="mx-5 relative h-full pb-4">
      {canEdit && (
        <div className="sticky top-0 z-10 sidesheet-theme pb-2">
          <Button block onClick={openCreateModal}>
            + {t("history_save_version")}
          </Button>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => preview && endPreview?.()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (preview) endPreview?.();
          }
        }}
        className={`p-2 my-2 rounded-sm cursor-pointer border-l-4 ${
          !preview
            ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30"
            : "border-transparent hover-1"
        }`}
      >
        <div className="font-semibold text-sm">{t("history_current")}</div>
        {peerNames && (
          <div className="text-xs opacity-75 truncate">{peerNames}</div>
        )}
      </div>

      {!loading && items.length === 0 && (
        <div className="my-3 text-sm opacity-75">{t("history_empty")}</div>
      )}

      {groups.map((group) => {
        const header = groupTitle(group, t);
        return (
          <div key={`${group.key}-${group.label ?? ""}`} className="my-3">
            <div className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">
              {header}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isSelected =
                  preview?.kind !== "ai" && preview?.id === item.id;
                const timeText = formatHour(item.createdAt);
                const authorsText = formatAuthors(item);

                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => previewSnapshot?.(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        previewSnapshot?.(item.id);
                      }
                    }}
                    className={`p-2 rounded-sm cursor-pointer flex items-start justify-between gap-2 border-l-4 ${
                      isSelected
                        ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30"
                        : item.kind === "named"
                          ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/20 hover-1"
                          : "border-transparent hover-1"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      {item.kind === "named" ? (
                        <>
                          <div className="font-semibold text-sm truncate">
                            {`★ ${item.name ?? ""}`}
                          </div>
                          <div className="text-xs opacity-75 truncate">
                            {[timeText, authorsText]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="font-semibold">{timeText}</span>
                            {item.kind === "pre_bulk_delete" && (
                              <span className="text-xs text-red-600 dark:text-red-400">
                                · {t("history_kind_pre_bulk_delete")}
                              </span>
                            )}
                            {item.kind === "pre_restore" && (
                              <span className="text-xs text-amber-600 dark:text-amber-400">
                                · {t("history_kind_pre_restore")}
                              </span>
                            )}
                            {item.kind === "pre_ai_apply" && (
                              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                                · {t("history_kind_pre_ai_apply")}
                              </span>
                            )}
                          </div>
                          {authorsText && (
                            <div className="text-xs opacity-75 truncate">
                              {authorsText}
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {canEdit && item.kind === "named" && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Dropdown
                          trigger="click"
                          position="bottomRight"
                          render={
                            <Dropdown.Menu>
                              <Dropdown.Item
                                onClick={() => openRenameModal(item)}
                              >
                                {t("history_rename")}
                              </Dropdown.Item>
                              <Dropdown.Item
                                type="danger"
                                onClick={() => confirmDelete(item)}
                              >
                                {t("delete")}
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          }
                        >
                          <Button
                            size="small"
                            theme="borderless"
                            aria-label={t("history_rename")}
                          >
                            <i className="fa-solid fa-ellipsis-vertical" />
                          </Button>
                        </Dropdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {loading && (
        <div className="text-blue-500 text-center my-3">
          <Spin size="middle" />
          <div>{t("loading")}</div>
        </div>
      )}

      {nextCursor && !loading && (
        <div className="text-center my-3">
          <Button onClick={loadMore} loading={loadingMore}>
            {t("history_load_more")}
          </Button>
        </div>
      )}

      <Modal
        visible={Boolean(dialog)}
        title={
          dialog?.mode === "rename"
            ? t("history_rename")
            : t("history_save_version")
        }
        okText={t("save")}
        cancelText={t("cancel")}
        onOk={handleModalOk}
        onCancel={closeModal}
        confirmLoading={savingModal}
        okButtonProps={{ disabled: !trimmedName }}
      >
        <Input
          autoFocus
          maxLength={80}
          placeholder={t("history_version_name")}
          value={versionName}
          onChange={setVersionName}
          onEnterPress={() => trimmedName && handleModalOk()}
        />
      </Modal>
    </div>
  );
}

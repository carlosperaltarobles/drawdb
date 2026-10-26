import { Button, Modal, Toast } from "@douyinfe/semi-ui";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import * as history from "../api/history";
import { useProjectCollab } from "./ProjectCollabProvider";

function toLocalDateTime(value) {
  if (DateTime.isDateTime(value)) return value.toLocal();
  if (value instanceof Date) return DateTime.fromJSDate(value).toLocal();
  return DateTime.fromISO(String(value)).toLocal();
}

export function formatHistoryTime(value, now = new Date()) {
  if (!value) return "";
  const dt = toLocalDateTime(value);
  if (!dt.isValid) return "";
  const today = toLocalDateTime(now);
  return dt.hasSame(today, "day")
    ? dt.toFormat("HH:mm")
    : dt.toFormat("dd/MM HH:mm");
}

export default function PreviewBanner() {
  const collab = useProjectCollab();
  const { t } = useTranslation();
  const preview = collab?.preview;
  if (!preview) return null;

  const { projectId, role, endPreview } = collab;
  const canRestore = role === "admin" || role === "editor";

  if (preview.kind === "ai") {
    const proposal = preview.proposal;
    const isStale = Boolean(preview.stale || proposal?.stale);
    const counts = proposal?.summary?.counts ?? {
      added: 0,
      modified: 0,
      removed: 0,
    };

    return (
      <div
        role="status"
        data-testid="ai-preview-banner"
        className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm ${
          isStale
            ? "bg-amber-100 text-amber-950 dark:bg-amber-950/70 dark:text-amber-100"
            : "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/60 dark:text-emerald-100"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {t(isStale ? "ai_preview_stale_banner" : "ai_preview_banner", {
              revision: proposal?.revision ?? 1,
            })}
          </span>
          <span className="text-xs opacity-80">
            {t("ai_proposal_counts", counts)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small"
            data-testid="ai-preview-exit"
            onClick={() => endPreview?.()}
          >
            {t("ai_proposal_exit_preview")}
          </Button>
          {isStale && preview.onRegenerate && (
            <Button
              size="small"
              type="warning"
              data-testid="ai-preview-regenerate"
              onClick={() => preview.onRegenerate?.()}
            >
              {t("ai_proposal_regenerate")}
            </Button>
          )}
          {canRestore && (
            <>
              <Button
                size="small"
                type="danger"
                data-testid="ai-preview-discard"
                onClick={() => preview.onDiscard?.()}
              >
                {t("ai_proposal_discard")}
              </Button>
              <Button
                size="small"
                type="primary"
                theme="solid"
                data-testid="ai-preview-accept"
                disabled={isStale}
                onClick={() => preview.onApply?.()}
              >
                {t("ai_proposal_accept")}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const time = formatHistoryTime(preview.createdAt);

  const handleRestore = () => {
    Modal.confirm({
      title: t("history_restore"),
      content: t("history_restore_confirm"),
      okText: t("history_restore"),
      cancelText: t("cancel"),
      onOk: async () => {
        try {
          await history.restore(projectId, preview.id);
        } catch {
          Toast.error(t("history_restore_failed"));
        }
      },
    });
  };

  return (
    <div
      role="status"
      data-testid="preview-banner"
      className="flex flex-wrap items-center justify-between gap-2 bg-blue-50 px-4 py-2 text-sm text-blue-950 dark:bg-blue-950/60 dark:text-blue-100"
    >
      <span>{t("history_preview_banner", { time })}</span>
      <div className="flex items-center gap-2">
        <Button size="small" onClick={() => endPreview?.()}>
          {t("history_back_to_current")}
        </Button>
        {canRestore && (
          <Button
            size="small"
            type="primary"
            theme="solid"
            onClick={handleRestore}
          >
            {t("history_restore")}
          </Button>
        )}
      </div>
    </div>
  );
}

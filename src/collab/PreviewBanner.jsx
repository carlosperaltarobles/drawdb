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

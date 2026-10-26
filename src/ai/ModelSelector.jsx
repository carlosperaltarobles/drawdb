import { useMemo, useState } from "react";
import { Button, Input, Select, Spin, Tag } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import {
  filterModels,
  getModelCapabilities,
  mapAiErrorCode,
} from "./aiState";

export default function ModelSelector({
  catalog = { items: [], fetchedAt: null, stale: false, defaultModel: null },
  selectedModel = null,
  disabled = false,
  initialSearch = "",
  onSelectModel,
  onRefresh,
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState(initialSearch);

  const items = useMemo(
    () => (Array.isArray(catalog?.items) ? catalog.items : []),
    [catalog?.items],
  );
  const filtered = useMemo(
    () => filterModels(items, search),
    [items, search],
  );

  const effectiveModelId = selectedModel ?? catalog?.defaultModel ?? null;
  const capabilities = useMemo(
    () => getModelCapabilities(catalog, effectiveModelId),
    [catalog, effectiveModelId],
  );

  return (
    <div
      data-testid="ai-model-selector"
      className="space-y-1.5 border-b border-zinc-200 dark:border-zinc-700 pb-2"
    >
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold uppercase tracking-wide opacity-75">
          {t("ai_model_label")}
        </label>
        <Button
          size="small"
          theme="borderless"
          data-testid="ai-refresh-models"
          aria-label={t("ai_refresh_models")}
          disabled={disabled || Boolean(catalog?.loading)}
          onClick={() => onRefresh?.()}
        >
          {catalog?.loading ? <Spin size="small" /> : t("ai_refresh_models")}
        </Button>
      </div>

      <Input
        value={search}
        placeholder={t("ai_model_search_placeholder")}
        aria-label={t("ai_model_search_placeholder")}
        onChange={(val) =>
          setSearch(typeof val === "string" ? val : val?.target?.value ?? "")
        }
      />

      {catalog?.error && (
        <div
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
          data-testid="ai-catalog-error"
        >
          {t(mapAiErrorCode(catalog.error))}
        </div>
      )}

      {catalog?.stale && (
        <div
          role="status"
          className="text-xs text-amber-600 dark:text-amber-400"
          data-testid="ai-catalog-stale"
        >
          {t("ai_models_stale")}
        </div>
      )}

      {!catalog?.loading && items.length === 0 ? (
        <div
          role="status"
          className="text-xs opacity-75"
          data-testid="ai-catalog-empty"
        >
          {t("ai_models_empty")}
        </div>
      ) : (
        <Select
          value={effectiveModelId ?? ""}
          aria-label={t("ai_model_label")}
          disabled={disabled}
          onChange={(val) => onSelectModel?.(val)}
          style={{ width: "100%" }}
        >
          {filtered.map((item) => (
            <Select.Option key={item.id} value={item.id}>
              {item.label || item.id}
              {item.provider ? ` (${item.provider})` : ""}
            </Select.Option>
          ))}
        </Select>
      )}

      {effectiveModelId && items.length > 0 && !capabilities.available && (
        <div
          role="alert"
          data-testid="ai-model-unavailable"
          className="text-xs text-red-600 dark:text-red-400"
        >
          {t("ai_model_unavailable_notice", { model: effectiveModelId })}
        </div>
      )}

      {capabilities.available && capabilities.chatOnly && (
        <div
          role="status"
          data-testid="ai-model-chat-only"
          className="text-xs text-amber-600 dark:text-amber-400"
        >
          {t("ai_model_chat_only")}
        </div>
      )}

      {capabilities.available && capabilities.hasUnknownCapabilities && (
        <div
          role="status"
          data-testid="ai-model-unknown-caps"
          className="text-xs text-amber-600 dark:text-amber-400"
        >
          {t("ai_model_unknown_capabilities")}
        </div>
      )}

      {capabilities.available && capabilities.canPropose && (
        <div className="flex flex-wrap items-center gap-1 text-xs opacity-75">
          <Tag size="small">{t("ai_model_supports_proposals")}</Tag>
          {capabilities.model?.contextWindow && (
            <span>
              {Math.round(capabilities.model.contextWindow / 1024)}k ctx
            </span>
          )}
        </div>
      )}
    </div>
  );
}

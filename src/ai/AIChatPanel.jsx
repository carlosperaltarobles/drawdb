import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, Select, Spin, Tag, TextArea, Toast } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { useFocus, useTransform } from "../hooks";
import { useProjectCollab } from "../collab/ProjectCollabProvider";
import ModelSelector from "./ModelSelector";
import { locateProposalItem } from "./proposalMarkers";
import {
  AI_MAX_MESSAGE_LENGTH,
  PROPOSAL_ITEMS_PAGE_SIZE,
  createAiController,
  mapAiErrorCode,
  paginateChangeItems,
} from "./aiState";

function buildDefaultState(role = "editor", initialState = null) {
  const canEdit = ["admin", "editor"].includes(role);
  return {
    role,
    canEdit,
    version: 0,
    disposed: false,
    catalog: {
      items: [],
      fetchedAt: null,
      stale: false,
      defaultModel: null,
      loading: false,
      error: null,
    },
    conversations: { items: [], nextCursor: null, loading: false },
    activeConversationId: null,
    activeConversation: null,
    pendingModel: null,
    modelUnavailable: false,
    messages: { items: [], nextCursor: null, loading: false },
    proposals: [],
    activeProposal: null,
    previewDetail: null,
    generation: {
      active: false,
      id: null,
      messageId: null,
      requestedModel: null,
      progress: null,
      lastEventId: null,
      error: null,
    },
    continuation: null,
    submitting: false,
    applyingProposal: false,
    error: null,
    ...initialState,
  };
}

export default function AIChatPanel({
  initialOpen = true,
  role: propRole,
  initialState = null,
  api,
  onLocateItem,
}) {
  const collab = useProjectCollab();
  const transformCtx = useTransform();
  const focusCtx = useFocus();
  const { t } = useTranslation();

  const projectId = collab?.projectId ?? initialState?.projectId ?? "project";
  const effectiveRole = propRole ?? collab?.role ?? initialState?.role ?? "editor";
  const version = collab?.version ?? initialState?.version ?? 0;
  const lastRestoredAt = collab?.lastRestoredAt ?? 0;
  const preview = collab?.preview ?? null;

  const [open, setOpen] = useState(initialOpen);
  const [draft, setDraft] = useState("");
  const [proposalPage, setProposalPage] = useState(1);
  const [aiState, setAiState] = useState(() =>
    buildDefaultState(effectiveRole, initialState),
  );

  const controllerRef = useRef(null);
  if (!controllerRef.current && !initialState) {
    controllerRef.current = createAiController({
      projectId,
      api,
      waitForAckedVersion: collab?.waitForAckedVersion,
      startAiPreview: collab?.startAiPreview,
      endPreview: collab?.endPreview,
      initialRole: effectiveRole,
      initialVersion: version,
      onStateChange: (next) => setAiState({ ...next }),
    });
  }

  useEffect(() => {
    if (initialState) return;
    const ctrl = controllerRef.current;
    ctrl?.initialize();
    return () => {
      ctrl?.handleProjectExit("unmount");
    };
  }, [initialState]);

  useEffect(() => {
    if (initialState) return;
    controllerRef.current?.syncCollabState({
      version,
      role: effectiveRole,
      lastRestoredAt,
    });
  }, [version, effectiveRole, lastRestoredAt, initialState]);

  const canEdit =
    aiState.canEdit !== undefined
      ? Boolean(aiState.canEdit)
      : ["admin", "editor"].includes(effectiveRole);

  const selectedModel =
    aiState.activeConversation?.selectedModel ??
    aiState.pendingModel ??
    aiState.catalog?.defaultModel ??
    null;

  const activeProposal = aiState.activeProposal;
  const isPreviewingProposal =
    preview?.kind === "ai" &&
    activeProposal &&
    preview?.id === activeProposal.id;

  const paginatedChanges = useMemo(
    () =>
      paginateChangeItems(
        activeProposal?.summary?.items ?? [],
        proposalPage,
        PROPOSAL_ITEMS_PAGE_SIZE,
      ),
    [activeProposal?.summary?.items, proposalPage],
  );

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || aiState.submitting || aiState.generation?.active) return;
    try {
      setDraft("");
      await controllerRef.current?.sendUserMessage(trimmed);
    } catch (err) {
      setDraft(trimmed);
      Toast.error(t(mapAiErrorCode(err)));
    }
  };

  const handleDeleteConversation = () => {
    if (!aiState.activeConversationId) return;
    Modal.confirm({
      title: t("ai_delete_conversation"),
      content: t("ai_delete_conversation_confirm"),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { type: "danger" },
      onOk: async () => {
        await controllerRef.current?.removeConversation(
          aiState.activeConversationId,
        );
      },
    });
  };

  if (!open) {
    return (
      <div className="border-l border-zinc-200 dark:border-zinc-700 p-2 flex flex-col items-center">
        <Button
          size="small"
          data-testid="ai-open-panel"
          aria-label={t("ai_toggle_panel")}
          onClick={() => setOpen(true)}
        >
          {t("ai_toggle_panel")}
        </Button>
      </div>
    );
  }

  return (
    <aside
      aria-label={t("ai_agent_title")}
      data-testid="ai-chat-panel"
      className="w-96 shrink-0 h-full border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col text-sm"
    >
      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between gap-2">
        <div className="font-semibold truncate">{t("ai_agent_title")}</div>
        <div className="flex items-center gap-1">
          <Button
            size="small"
            theme="borderless"
            data-testid="ai-new-conversation"
            aria-label={t("ai_new_conversation")}
            disabled={Boolean(aiState.generation?.active)}
            onClick={() => controllerRef.current?.startNewConversation()}
          >
            + {t("ai_new_conversation")}
          </Button>
          <Button
            size="small"
            theme="borderless"
            data-testid="ai-collapse-panel"
            aria-label={t("ai_toggle_panel")}
            onClick={() => setOpen(false)}
          >
            ×
          </Button>
        </div>
      </div>

      <div className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-800/60 text-xs opacity-80 border-b border-zinc-200 dark:border-zinc-700">
        <div>{t("ai_private_notice")}</div>
        {!canEdit && (
          <div
            data-testid="ai-viewer-notice"
            className="mt-1 text-amber-700 dark:text-amber-300 font-medium"
          >
            {t("ai_viewer_readonly_notice")}
          </div>
        )}
      </div>

      <div className="px-3 py-2 space-y-2 border-b border-zinc-200 dark:border-zinc-700">
        {aiState.conversations?.items?.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Select
              value={aiState.activeConversationId ?? ""}
              aria-label={t("ai_conversation_label")}
              disabled={Boolean(aiState.generation?.active)}
              onChange={(cid) => controllerRef.current?.selectConversation(cid)}
              style={{ flex: 1 }}
            >
              {aiState.conversations.items.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.title || c.id.slice(0, 8)}
                </Select.Option>
              ))}
            </Select>
            <Button
              size="small"
              type="danger"
              theme="borderless"
              data-testid="ai-delete-conversation"
              aria-label={t("ai_delete_conversation")}
              onClick={handleDeleteConversation}
            >
              {t("delete")}
            </Button>
          </div>
        )}

        <ModelSelector
          catalog={aiState.catalog}
          selectedModel={selectedModel}
          disabled={Boolean(aiState.generation?.active)}
          onSelectModel={(m) => controllerRef.current?.changeModel(m)}
          onRefresh={() => controllerRef.current?.refreshModels()}
        />
      </div>

      {aiState.error && (
        <div
          role="alert"
          data-testid="ai-error-banner"
          className="px-3 py-1.5 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-200 text-xs"
        >
          {t(mapAiErrorCode(aiState.error))}
        </div>
      )}

      <div
        role="log"
        aria-live="polite"
        data-testid="ai-message-list"
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2"
      >
        {!aiState.messages?.loading &&
          (aiState.messages?.items?.length ?? 0) === 0 && (
            <div className="text-xs opacity-60 py-4 text-center">
              {t("ai_empty_messages")}
            </div>
          )}

        {(aiState.messages?.items ?? []).map((msg) => {
          const isUser = msg.role === "user";
          const modelBadge = msg.reportedModel || msg.requestedModel;
          return (
            <div
              key={msg.id}
              data-testid={`ai-message-${msg.role}`}
              className={`rounded-md p-2 text-xs whitespace-pre-wrap break-words ${
                isUser
                  ? "bg-blue-50 dark:bg-blue-950/40 ms-4"
                  : "bg-zinc-100 dark:bg-zinc-800 me-4"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1 opacity-75">
                <span className="font-semibold">
                  {isUser ? t("you") : t("ai_agent_title")}
                </span>
                {!isUser && modelBadge && <Tag size="small">{modelBadge}</Tag>}
              </div>
              <div>{String(msg.content ?? "")}</div>
            </div>
          );
        })}

        {aiState.generation?.active && (
          <div
            role="status"
            data-testid="ai-generation-status"
            className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 p-2 text-xs space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <Spin size="small" />
              {aiState.generation.progress && (
                <span>
                  {t("ai_progress_status", {
                    reviewed: aiState.generation.progress.reviewed,
                    remaining: aiState.generation.progress.remaining,
                  })}
                </span>
              )}
              <Button
                size="small"
                type="warning"
                data-testid="ai-cancel-generation"
                onClick={() => controllerRef.current?.cancelActiveGeneration()}
              >
                {t("ai_cancel_generation")}
              </Button>
            </div>
          </div>
        )}

        {aiState.continuation && (
          <div className="py-1">
            <Button
              size="small"
              block
              data-testid="ai-continue-analysis"
              disabled={Boolean(aiState.generation?.active)}
              onClick={() => controllerRef.current?.continueAnalysis()}
            >
              {t("ai_continue_analysis")}
            </Button>
          </div>
        )}

        {activeProposal && (
          <div
            data-testid="ai-proposal-card"
            className="rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/30 p-2.5 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{t("ai_proposal_title")}</span>
              <Tag size="small">
                {t("ai_proposal_revision", {
                  revision: activeProposal.revision,
                })}
              </Tag>
            </div>

            <div>
              {t("ai_proposal_counts", {
                added: activeProposal.summary?.counts?.added ?? 0,
                modified: activeProposal.summary?.counts?.modified ?? 0,
                removed: activeProposal.summary?.counts?.removed ?? 0,
              })}
            </div>

            {activeProposal.stale && (
              <div
                role="alert"
                data-testid="ai-proposal-stale"
                className="text-amber-700 dark:text-amber-300 font-medium"
              >
                {t("ai_proposal_stale_warning")}
              </div>
            )}

            <div className="space-y-1 max-h-44 overflow-y-auto">
              {paginatedChanges.items.map((item, idx) => {
                const label =
                  item.afterName || item.beforeName || String(item.id);
                const handleLocate = () => {
                  if (onLocateItem) {
                    onLocateItem(item, activeProposal);
                    return;
                  }
                  const detail = aiState.previewDetail ?? preview;
                  if (!detail) return;
                  const loc = locateProposalItem(
                    item,
                    detail,
                    transformCtx?.transform?.zoom,
                  );
                  if (loc && transformCtx?.setTransform) {
                    transformCtx.setTransform((prev) => ({
                      ...prev,
                      pan: loc.pan,
                      zoom: loc.zoom,
                    }));
                    if (loc.coll === "tables") {
                      focusCtx?.flashTable?.(loc.targetId);
                    }
                  }
                };
                return (
                  <div
                    key={`${item.coll}-${item.id}-${idx}`}
                    role="button"
                    tabIndex={0}
                    onClick={handleLocate}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleLocate();
                      }
                    }}
                    className="flex items-center justify-between gap-1 px-1.5 py-1 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-700/50 cursor-pointer"
                  >
                    <span className="truncate font-mono">
                      [{item.coll}] {label}
                    </span>
                    <Tag size="small">{item.change}</Tag>
                  </div>
                );
              })}
            </div>

            {paginatedChanges.totalPages > 1 && (
              <div className="flex items-center justify-between gap-1 pt-1">
                <Button
                  size="small"
                  disabled={paginatedChanges.page <= 1}
                  onClick={() => setProposalPage((p) => Math.max(1, p - 1))}
                >
                  {t("ai_proposal_prev_page")}
                </Button>
                <span>
                  {t("ai_proposal_page_info", {
                    page: paginatedChanges.page,
                    totalPages: paginatedChanges.totalPages,
                    totalItems: paginatedChanges.totalItems,
                  })}
                </span>
                <Button
                  size="small"
                  disabled={
                    paginatedChanges.page >= paginatedChanges.totalPages
                  }
                  onClick={() =>
                    setProposalPage((p) =>
                      Math.min(paginatedChanges.totalPages, p + 1),
                    )
                  }
                >
                  {t("ai_proposal_next_page")}
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Button
                size="small"
                data-testid="ai-proposal-preview-btn"
                onClick={() =>
                  isPreviewingProposal
                    ? collab?.endPreview?.()
                    : controllerRef.current?.openProposalPreview(
                        activeProposal.id,
                      )
                }
              >
                {t(
                  isPreviewingProposal
                    ? "ai_proposal_exit_preview"
                    : "ai_proposal_preview",
                )}
              </Button>

              {canEdit && (
                <>
                  <Button
                    size="small"
                    type="primary"
                    theme="solid"
                    data-testid="ai-proposal-accept-btn"
                    disabled={
                      Boolean(activeProposal.stale) ||
                      Boolean(aiState.applyingProposal)
                    }
                    onClick={() =>
                      controllerRef.current?.acceptProposal(activeProposal.id)
                    }
                  >
                    {t("ai_proposal_accept")}
                  </Button>
                  <Button
                    size="small"
                    type="danger"
                    data-testid="ai-proposal-discard-btn"
                    onClick={() =>
                      controllerRef.current?.discardPendingProposal(
                        activeProposal.id,
                      )
                    }
                  >
                    {t("ai_proposal_discard")}
                  </Button>
                </>
              )}

              {activeProposal.stale && (
                <Button
                  size="small"
                  data-testid="ai-proposal-regenerate-btn"
                  onClick={() =>
                    controllerRef.current?.regenerateProposal(activeProposal.id)
                  }
                >
                  {t("ai_proposal_regenerate")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-2.5 border-t border-zinc-200 dark:border-zinc-700 space-y-1.5">
        <TextArea
          value={draft}
          maxLength={AI_MAX_MESSAGE_LENGTH}
          placeholder={t("ai_message_placeholder")}
          aria-label={t("ai_message_placeholder")}
          onChange={(val) =>
            setDraft(typeof val === "string" ? val : val?.target?.value ?? "")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs opacity-60">
            {draft.length}/{AI_MAX_MESSAGE_LENGTH}
          </span>
          <Button
            size="small"
            type="primary"
            theme="solid"
            data-testid="ai-send-btn"
            disabled={
              !draft.trim() ||
              Boolean(aiState.submitting) ||
              Boolean(aiState.generation?.active) ||
              Boolean(aiState.modelUnavailable)
            }
            onClick={handleSend}
          >
            {t("ai_send")}
          </Button>
        </div>
      </div>
    </aside>
  );
}

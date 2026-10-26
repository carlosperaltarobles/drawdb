import { v4 as uuidv4 } from "uuid";
import { errorCode } from "../api/http";
import * as defaultAiApi from "../api/ai";

export const AI_MAX_MESSAGE_LENGTH = 8000;
export const PROPOSAL_ITEMS_PAGE_SIZE = 25;

const ERROR_KEY_BY_CODE = {
  ai_disabled: "ai_error_disabled",
  ai_unavailable: "ai_error_unavailable",
  ai_limit: "ai_error_limit",
  ai_busy: "ai_error_busy",
  ai_model_unavailable: "ai_error_model_unavailable",
  ai_unsupported: "ai_error_unsupported",
  ai_invalid_proposal: "ai_error_invalid_proposal",
  ai_stale_proposal: "ai_error_stale_proposal",
  ai_expired_proposal: "ai_error_expired_proposal",
  invalid_input: "invalid_input",
  forbidden: "ai_error_forbidden",
  not_found: "ai_error_not_found",
};

export function mapAiErrorCode(codeOrError) {
  const code =
    typeof codeOrError === "string"
      ? codeOrError
      : errorCode(codeOrError) || codeOrError?.message;
  return ERROR_KEY_BY_CODE[code] || "something_went_wrong";
}

export function extractErrorCode(err, fallback = "ai_unavailable") {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return errorCode(err) || err.code || err.message || fallback;
}

export function getModelCapabilities(catalog, modelId) {
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  if (!modelId) {
    return {
      available: false,
      canChat: false,
      canPropose: false,
      chatOnly: false,
      hasUnknownCapabilities: false,
      model: null,
    };
  }
  const model = items.find((m) => m.id === modelId) || null;
  if (!model) {
    return {
      available: false,
      canChat: false,
      canPropose: false,
      chatOnly: false,
      hasUnknownCapabilities: false,
      model: null,
    };
  }
  const caps = model.capabilities || {};
  const canChat = caps.chat === true;
  const canPropose =
    canChat && (caps.tools === true || caps.json === true);
  const hasUnknownCapabilities = [
    caps.chat,
    caps.tools,
    caps.json,
    caps.stream,
  ].some((val) => val === null || val === undefined);
  const chatOnly = canChat && !canPropose && !hasUnknownCapabilities;

  return {
    available: true,
    canChat,
    canPropose,
    chatOnly,
    hasUnknownCapabilities,
    model,
  };
}

export function filterModels(items = [], query = "") {
  const q = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const label = String(item.label ?? "").toLowerCase();
    const id = String(item.id ?? "").toLowerCase();
    const provider = String(item.provider ?? "").toLowerCase();
    return label.includes(q) || id.includes(q) || provider.includes(q);
  });
}

export function paginateChangeItems(
  items = [],
  page = 1,
  pageSize = PROPOSAL_ITEMS_PAGE_SIZE,
) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Number(pageSize) || PROPOSAL_ITEMS_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  const start = (safePage - 1) * size;
  return {
    items: list.slice(start, start + size),
    page: safePage,
    pageSize: size,
    totalPages,
    totalItems: list.length,
  };
}

function computeProposalStale(proposal, currentVersion) {
  if (!proposal) return false;
  if (proposal.stale) return true;
  if (
    Number.isFinite(currentVersion) &&
    Number.isFinite(proposal.baseVersion) &&
    currentVersion > proposal.baseVersion
  ) {
    return true;
  }
  return false;
}

export function createAiController({
  projectId,
  api = defaultAiApi,
  waitForAckedVersion,
  startAiPreview,
  endPreview,
  initialRole = "editor",
  initialVersion = 0,
  onStateChange,
}) {
  let streamAbort = null;
  let lastRetryDraft = null;
  let lastRetryRequestId = null;

  let state = {
    projectId,
    role: initialRole,
    canEdit: ["admin", "editor"].includes(initialRole),
    version: initialVersion,
    lastRestoredAt: 0,
    disposed: false,
    exitReason: null,
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
  };

  const emit = (partial) => {
    state = { ...state, ...partial };
    const effectiveModel =
      state.activeConversation?.selectedModel ??
      state.pendingModel ??
      state.catalog.defaultModel;
    const hasLoadedCatalog = state.catalog.items.length > 0;
    const modelUnavailable = Boolean(
      effectiveModel &&
        hasLoadedCatalog &&
        !state.catalog.items.some((m) => m.id === effectiveModel),
    );
    state = { ...state, modelUnavailable };
    onStateChange?.(state);
    return state;
  };

  const abortStream = () => {
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }
  };

  const syncProposals = (rawProposals = [], currentVersion = state.version) => {
    const normalized = rawProposals.map((p) => ({
      ...p,
      stale: computeProposalStale(p, currentVersion),
    }));
    const pending =
      normalized.find((p) => p.status === "pending") ??
      state.activeProposal ??
      null;
    const activeProposal =
      pending && pending.status === "pending"
        ? { ...pending, stale: computeProposalStale(pending, currentVersion) }
        : null;
    return { proposals: normalized, activeProposal };
  };

  const loadConversationMessages = async (conversationId) => {
    if (!conversationId) return;
    emit({ messages: { ...state.messages, loading: true } });
    const res = await api.listMessages(projectId, conversationId);
    const { proposals, activeProposal } = syncProposals(
      res?.proposals ?? [],
      state.version,
    );
    emit({
      messages: {
        items: res?.items ?? [],
        nextCursor: res?.nextCursor ?? null,
        loading: false,
      },
      proposals,
      activeProposal,
    });
  };

  const handleSseEvent = async (ev, conversationId) => {
    if (state.disposed) return;
    const { id: eventId, event, data } = ev;
    if (event === "generation") {
      const assistantMsg = {
        id: data.messageId,
        role: "assistant",
        content: "",
        status: "pending",
        requestedModel: data.requestedModel ?? null,
        reportedModel: null,
        usage: null,
        createdAt: new Date().toISOString(),
      };
      const exists = state.messages.items.some((m) => m.id === data.messageId);
      emit({
        generation: {
          ...state.generation,
          active: true,
          id: data.generationId,
          messageId: data.messageId,
          requestedModel: data.requestedModel ?? null,
          lastEventId: eventId ?? state.generation.lastEventId,
          error: null,
        },
        messages: {
          ...state.messages,
          items: exists
            ? state.messages.items
            : [...state.messages.items, assistantMsg],
        },
      });
    } else if (event === "text") {
      const targetId = state.generation.messageId;
      const delta = String(data?.delta ?? "");
      const items = state.messages.items.map((m) =>
        m.id === targetId ? { ...m, content: `${m.content ?? ""}${delta}` } : m,
      );
      emit({
        generation: {
          ...state.generation,
          lastEventId: eventId ?? state.generation.lastEventId,
        },
        messages: { ...state.messages, items },
      });
    } else if (event === "progress") {
      emit({
        generation: {
          ...state.generation,
          progress: {
            reviewed: data.reviewed ?? 0,
            remaining: data.remaining ?? 0,
            scope: data.scope ?? null,
            baseVersion: data.baseVersion ?? state.version,
          },
          lastEventId: eventId ?? state.generation.lastEventId,
        },
      });
    } else if (event === "proposal") {
      emit({
        generation: {
          ...state.generation,
          lastEventId: eventId ?? state.generation.lastEventId,
        },
      });
      if (data?.proposalId && api.getProposal) {
        try {
          const detail = await api.getProposal(projectId, data.proposalId);
          if (detail?.proposal) {
            const stale = Boolean(
              detail.stale ||
                computeProposalStale(detail.proposal, state.version),
            );
            const prop = { ...detail.proposal, stale };
            emit({
              proposals: [
                prop,
                ...state.proposals.filter((p) => p.id !== prop.id),
              ],
              activeProposal: prop,
              previewDetail: { ...detail, proposal: prop, stale },
            });
          }
        } catch {
          // Reconciled on done or listMessages
        }
      }
    } else if (event === "done") {
      const targetId = data?.messageId ?? state.generation.messageId;
      const items = state.messages.items.map((m) =>
        m.id === targetId ? { ...m, status: "complete" } : m,
      );
      emit({
        generation: {
          ...state.generation,
          active: false,
          progress: null,
          lastEventId: eventId ?? state.generation.lastEventId,
        },
        continuation: data?.continuation ?? null,
        messages: { ...state.messages, items },
      });
      if (data?.proposalId && !state.activeProposal && api.getProposal) {
        try {
          const detail = await api.getProposal(projectId, data.proposalId);
          if (detail?.proposal) {
            const stale = Boolean(
              detail.stale ||
                computeProposalStale(detail.proposal, state.version),
            );
            const prop = { ...detail.proposal, stale };
            emit({ activeProposal: prop, previewDetail: { ...detail, stale } });
          }
        } catch {
          if (conversationId) await loadConversationMessages(conversationId);
        }
      }
    } else if (event === "error") {
      const code = data?.code || "ai_unavailable";
      const targetId = state.generation.messageId;
      const items = state.messages.items.map((m) =>
        m.id === targetId ? { ...m, status: "failed" } : m,
      );
      emit({
        error: code,
        generation: {
          ...state.generation,
          active: false,
          progress: null,
          error: code,
          lastEventId: eventId ?? state.generation.lastEventId,
        },
        messages: { ...state.messages, items },
      });
    }
  };

  const attachGenerationStream = async (generationId, conversationId) => {
    if (!api.subscribeGenerationEvents || !generationId) return;
    abortStream();
    const ac = new AbortController();
    streamAbort = ac;
    emit({
      generation: {
        ...state.generation,
        active: true,
        id: generationId,
        error: null,
      },
    });
    const res = await api.subscribeGenerationEvents(projectId, generationId, {
      conversationId,
      lastEventId: state.generation.lastEventId,
      signal: ac.signal,
      onEvent: (ev) => handleSseEvent(ev, conversationId),
    });
    if (res?.recoveredFromCanonical) {
      const gen = res.generation;
      const msgData = res.messages;
      if (msgData) {
        const { proposals, activeProposal } = syncProposals(
          msgData.proposals ?? [],
          state.version,
        );
        emit({
          messages: {
            items: msgData.items ?? [],
            nextCursor: msgData.nextCursor ?? null,
            loading: false,
          },
          proposals,
          activeProposal,
        });
      }
      emit({
        continuation: gen?.continuation ?? null,
        error: gen?.error ?? null,
        generation: {
          ...state.generation,
          active: gen?.status === "pending" || gen?.status === "running",
          id: gen?.id ?? generationId,
          messageId: gen?.messageId ?? state.generation.messageId,
          error: gen?.error ?? null,
        },
      });
    }
  };

  const controller = {
    getState: () => state,

    initialize: async () => {
      emit({
        catalog: { ...state.catalog, loading: true, error: null },
        conversations: { ...state.conversations, loading: true },
      });
      try {
        const [catalogRes, convRes] = await Promise.all([
          api.listModels ? api.listModels(projectId) : null,
          api.listConversations ? api.listConversations(projectId) : null,
        ]);
        const catalog = {
          items: catalogRes?.items ?? [],
          fetchedAt: catalogRes?.fetchedAt ?? null,
          stale: Boolean(catalogRes?.stale),
          defaultModel: catalogRes?.defaultModel ?? null,
          loading: false,
          error: null,
        };
        const convItems = convRes?.items ?? [];
        const firstConv = convItems[0] ?? null;
        emit({
          catalog,
          conversations: {
            items: convItems,
            nextCursor: convRes?.nextCursor ?? null,
            loading: false,
          },
          activeConversationId: firstConv?.id ?? null,
          activeConversation: firstConv,
          pendingModel: firstConv?.selectedModel ?? catalog.defaultModel,
        });
        if (firstConv?.id) {
          await loadConversationMessages(firstConv.id);
          if (firstConv.activeGenerationId) {
            await attachGenerationStream(
              firstConv.activeGenerationId,
              firstConv.id,
            );
          }
        }
      } catch (err) {
        const code = extractErrorCode(err);
        emit({
          error: code,
          catalog: { ...state.catalog, loading: false, error: code },
          conversations: { ...state.conversations, loading: false },
        });
      }
      return state;
    },

    refreshModels: async () => {
      emit({ catalog: { ...state.catalog, loading: true, error: null } });
      try {
        const catalogRes = await api.listModels(projectId, { refresh: true });
        emit({
          catalog: {
            items: catalogRes?.items ?? [],
            fetchedAt: catalogRes?.fetchedAt ?? null,
            stale: Boolean(catalogRes?.stale),
            defaultModel: catalogRes?.defaultModel ?? null,
            loading: false,
            error: null,
          },
        });
      } catch (err) {
        const code = extractErrorCode(err);
        emit({
          error: code,
          catalog: { ...state.catalog, loading: false, error: code },
        });
      }
      return state;
    },

    selectConversation: async (conversationId) => {
      const conv =
        state.conversations.items.find((c) => c.id === conversationId) ?? null;
      abortStream();
      emit({
        activeConversationId: conversationId,
        activeConversation: conv,
        pendingModel: conv?.selectedModel ?? state.catalog.defaultModel,
        activeProposal: null,
        previewDetail: null,
        continuation: null,
        error: null,
      });
      if (conv?.id) {
        await loadConversationMessages(conv.id);
        if (conv.activeGenerationId) {
          await attachGenerationStream(conv.activeGenerationId, conv.id);
        }
      }
      return state;
    },

    startNewConversation: async (selectedModel) => {
      const modelToUse =
        selectedModel ?? state.pendingModel ?? state.catalog.defaultModel;
      const created = await api.createConversation(projectId, {
        selectedModel: modelToUse,
      });
      emit({
        conversations: {
          ...state.conversations,
          items: [
            created,
            ...state.conversations.items.filter((c) => c.id !== created.id),
          ],
        },
        activeConversationId: created.id,
        activeConversation: created,
        pendingModel: created.selectedModel,
        messages: { items: [], nextCursor: null, loading: false },
        proposals: [],
        activeProposal: null,
        previewDetail: null,
        continuation: null,
        error: null,
      });
      return created;
    },

    changeModel: async (modelId) => {
      if (state.generation.active) {
        const err = new Error("ai_busy");
        emit({ error: "ai_busy" });
        throw err;
      }
      if (!state.activeConversation) {
        emit({ pendingModel: modelId, error: null });
        return state;
      }
      const updated = await api.updateConversation(
        projectId,
        state.activeConversation.id,
        { selectedModel: modelId },
      );
      emit({
        activeConversation: updated,
        pendingModel: updated.selectedModel,
        conversations: {
          ...state.conversations,
          items: state.conversations.items.map((c) =>
            c.id === updated.id ? updated : c,
          ),
        },
        error: null,
      });
      return state;
    },

    removeConversation: async (conversationId) => {
      const targetId = conversationId ?? state.activeConversationId;
      if (!targetId) return state;
      if (state.activeConversationId === targetId) abortStream();
      await api.deleteConversation(projectId, targetId);
      const remaining = state.conversations.items.filter(
        (c) => c.id !== targetId,
      );
      const nextConv = remaining[0] ?? null;
      if (state.activeProposal?.conversationId === targetId) {
        endPreview?.();
      }
      emit({
        conversations: { ...state.conversations, items: remaining },
        activeConversationId: nextConv?.id ?? null,
        activeConversation: nextConv,
        pendingModel: nextConv?.selectedModel ?? state.catalog.defaultModel,
        messages: { items: [], nextCursor: null, loading: false },
        proposals: [],
        activeProposal: null,
        previewDetail: null,
        continuation: null,
      });
      if (nextConv?.id) await loadConversationMessages(nextConv.id);
      return state;
    },

    sendUserMessage: async (content, { continuation } = {}) => {
      if (state.submitting || state.generation.active) {
        const err = new Error("ai_busy");
        emit({ error: "ai_busy" });
        throw err;
      }
      const text = String(content ?? "").trim();
      if (!text || text.length > AI_MAX_MESSAGE_LENGTH) {
        const err = new Error("invalid_input");
        emit({ error: "invalid_input" });
        throw err;
      }

      if (state.modelUnavailable) {
        const err = new Error("ai_model_unavailable");
        emit({ error: "ai_model_unavailable" });
        throw err;
      }

      emit({ submitting: true, error: null });
      try {
        if (waitForAckedVersion) {
          const acked = await waitForAckedVersion();
          if (Number.isFinite(acked?.version)) {
            emit({ version: acked.version });
          }
        }

        let conv = state.activeConversation;
        if (!conv) {
          conv = await controller.startNewConversation(
            state.pendingModel ?? state.catalog.defaultModel,
          );
        }

        const requestId =
          lastRetryDraft === text && lastRetryRequestId
            ? lastRetryRequestId
            : uuidv4();
        lastRetryDraft = text;
        lastRetryRequestId = requestId;

        const optimisticUserMsg = {
          id: `user-${requestId}`,
          role: "user",
          content: text,
          status: "complete",
          requestedModel: conv.selectedModel ?? null,
          reportedModel: null,
          usage: null,
          createdAt: new Date().toISOString(),
        };

        emit({
          messages: {
            ...state.messages,
            items: [...state.messages.items, optimisticUserMsg],
          },
          continuation: null,
        });

        const { generationId } = await api.sendMessage(projectId, conv.id, {
          content: text,
          requestId,
          ...(continuation !== undefined ? { continuation } : {}),
        });

        lastRetryDraft = null;
        lastRetryRequestId = null;
        emit({ submitting: false });
        await attachGenerationStream(generationId, conv.id);
        return state;
      } catch (err) {
        const code = extractErrorCode(err);
        emit({ submitting: false, error: code });
        throw err;
      }
    },

    continueAnalysis: async () => {
      if (!state.continuation) return state;
      return controller.sendUserMessage("Continuar análisis", {
        continuation: state.continuation,
      });
    },

    cancelActiveGeneration: async () => {
      const genId = state.generation.id;
      abortStream();
      if (genId && api.cancelGeneration) {
        try {
          await api.cancelGeneration(projectId, genId);
        } catch {
          // Idempotent cancel
        }
      }
      const targetId = state.generation.messageId;
      emit({
        generation: {
          ...state.generation,
          active: false,
          progress: null,
        },
        messages: {
          ...state.messages,
          items: state.messages.items.map((m) =>
            m.id === targetId ? { ...m, status: "cancelled" } : m,
          ),
        },
      });
      return state;
    },

    openProposalPreview: async (proposalId) => {
      const targetId = proposalId ?? state.activeProposal?.id;
      if (!targetId) return null;
      if (waitForAckedVersion) {
        const acked = await waitForAckedVersion();
        if (Number.isFinite(acked?.version)) {
          emit({ version: acked.version });
        }
      }
      const detail = await api.getProposal(projectId, targetId);
      const stale = Boolean(
        detail.stale || computeProposalStale(detail.proposal, state.version),
      );
      const prop = { ...detail.proposal, stale };
      const normalizedDetail = { ...detail, proposal: prop, stale };
      emit({
        activeProposal: prop,
        previewDetail: normalizedDetail,
        proposals: [
          prop,
          ...state.proposals.filter((p) => p.id !== prop.id),
        ],
      });
      startAiPreview?.({
        proposal: prop,
        before: detail.before,
        after: detail.after,
        stale,
        onApply: () => controller.acceptProposal(targetId),
        onDiscard: () => controller.discardPendingProposal(targetId),
        onRegenerate: () => controller.regenerateProposal(targetId),
      });
      return normalizedDetail;
    },

    acceptProposal: async (proposalId) => {
      const prop =
        state.proposals.find((p) => p.id === proposalId) ??
        state.activeProposal;
      if (!prop) return null;
      if (!state.canEdit) {
        const err = new Error("forbidden");
        emit({ error: "forbidden" });
        throw err;
      }
      if (computeProposalStale(prop, state.version)) {
        emit({
          error: "ai_stale_proposal",
          activeProposal: { ...prop, stale: true },
        });
        throw new Error("ai_stale_proposal");
      }

      emit({ applyingProposal: true, error: null });
      try {
        if (waitForAckedVersion) {
          await waitForAckedVersion();
        }
        const res = await api.applyProposal(projectId, prop.id, {
          revision: prop.revision,
        });
        const appliedProp = {
          ...prop,
          status: "applied",
          appliedVersion: res?.version ?? null,
          snapshotId: res?.snapshotId ?? null,
          stale: false,
        };
        endPreview?.();
        emit({
          applyingProposal: false,
          version: Number.isFinite(res?.version) ? res.version : state.version,
          activeProposal: null,
          previewDetail: null,
          proposals: state.proposals.map((p) =>
            p.id === prop.id ? appliedProp : p,
          ),
        });
        return res;
      } catch (err) {
        const code = extractErrorCode(err);
        const isStale = code === "ai_stale_proposal";
        const isExpired = code === "ai_expired_proposal";
        const nextProp = {
          ...prop,
          stale: isStale ? true : prop.stale,
          status: isExpired ? "expired" : prop.status,
        };
        emit({
          applyingProposal: false,
          error: code,
          activeProposal: isExpired ? null : nextProp,
          previewDetail: state.previewDetail
            ? { ...state.previewDetail, proposal: nextProp, stale: nextProp.stale }
            : null,
        });
        throw err;
      }
    },

    discardPendingProposal: async (proposalId) => {
      const targetId = proposalId ?? state.activeProposal?.id;
      if (!targetId) return state;
      await api.discardProposal(projectId, targetId);
      endPreview?.();
      emit({
        activeProposal: null,
        previewDetail: null,
        proposals: state.proposals.map((p) =>
          p.id === targetId ? { ...p, status: "discarded" } : p,
        ),
      });
      return state;
    },

    regenerateProposal: async () => {
      endPreview?.();
      return controller.sendUserMessage(
        "Regenera la propuesta sobre la versión actual del diagrama.",
      );
    },

    syncCollabState: ({ version, role, lastRestoredAt } = {}) => {
      const nextVersion = Number.isFinite(version) ? version : state.version;
      const nextRole = role ?? state.role;
      const canEdit = ["admin", "editor"].includes(nextRole);
      const restoredChanged =
        Number.isFinite(lastRestoredAt) &&
        lastRestoredAt > 0 &&
        lastRestoredAt !== state.lastRestoredAt;

      if (restoredChanged) {
        endPreview?.();
      }

      const proposals = state.proposals.map((p) => ({
        ...p,
        stale: restoredChanged || computeProposalStale(p, nextVersion),
      }));
      const activeProposal = state.activeProposal
        ? {
            ...state.activeProposal,
            stale:
              restoredChanged ||
              computeProposalStale(state.activeProposal, nextVersion),
          }
        : null;
      const previewDetail = state.previewDetail
        ? {
            ...state.previewDetail,
            stale:
              restoredChanged ||
              Boolean(activeProposal?.stale) ||
              state.previewDetail.stale,
          }
        : null;

      emit({
        version: nextVersion,
        role: nextRole,
        canEdit,
        lastRestoredAt: lastRestoredAt ?? state.lastRestoredAt,
        applyingProposal: canEdit ? state.applyingProposal : false,
        proposals,
        activeProposal,
        previewDetail,
      });
      return state;
    },

    handleProjectExit: (reason) => {
      abortStream();
      endPreview?.();
      emit({
        disposed: true,
        exitReason: reason ?? "closed",
        generation: { ...state.generation, active: false, progress: null },
      });
      return state;
    },
  };

  return controller;
}

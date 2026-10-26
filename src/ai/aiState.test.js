import { describe, expect, it, vi } from "vitest";
import protocolFixture from "./__fixtures__/protocol.json";
import {
  AI_MAX_MESSAGE_LENGTH,
  createAiController,
  filterModels,
  getModelCapabilities,
  mapAiErrorCode,
} from "./aiState";

describe("aiState helpers and controller", () => {
  it("classifies model capabilities strictly and never treats null as authorized", () => {
    const catalog = {
      ...protocolFixture.catalog,
      items: [
        ...protocolFixture.catalog.items,
        {
          id: "chat-unknown",
          label: "Chat Unknown",
          provider: "fixture",
          capabilities: { chat: true, tools: null, json: null, stream: null },
          contextWindow: null,
          maxOutputTokens: null,
        },
      ],
    };

    const capA = getModelCapabilities(catalog, "chat-a");
    expect(capA.available).toBe(true);
    expect(capA.canChat).toBe(true);
    expect(capA.canPropose).toBe(true);
    expect(capA.hasUnknownCapabilities).toBe(false);

    const capB = getModelCapabilities(catalog, "chat-b");
    expect(capB.available).toBe(true);
    expect(capB.canChat).toBe(true);
    expect(capB.canPropose).toBe(false);
    expect(capB.chatOnly).toBe(true);

    const capUnknown = getModelCapabilities(catalog, "chat-unknown");
    expect(capUnknown.available).toBe(true);
    expect(capUnknown.canChat).toBe(true);
    expect(capUnknown.canPropose).toBe(false);
    expect(capUnknown.hasUnknownCapabilities).toBe(true);

    const capMissing = getModelCapabilities(catalog, "removed-model");
    expect(capMissing.available).toBe(false);
    expect(capMissing.canChat).toBe(false);
    expect(capMissing.canPropose).toBe(false);

    expect(filterModels(catalog.items, "unknown")).toHaveLength(1);
    expect(filterModels(catalog.items, "Chat B")[0].id).toBe("chat-b");
  });

  it("prevents silent model fallback when conversation selectedModel disappeared from catalog", async () => {
    const api = {
      listModels: vi.fn(async () => protocolFixture.catalog),
      listConversations: vi.fn(async () => ({
        items: [
          {
            id: "conv-1",
            projectId: "p1",
            selectedModel: "gone-model",
            title: "Test",
            updatedAt: "2026-10-26T12:00:00.000Z",
            activeGenerationId: null,
          },
        ],
        nextCursor: null,
      })),
      listMessages: vi.fn(async () => ({
        items: [],
        proposals: [],
        nextCursor: null,
      })),
      sendMessage: vi.fn(),
    };

    const ctrl = createAiController({
      projectId: "p1",
      api,
      waitForAckedVersion: vi.fn(async () => ({ version: 1, doc: {} })),
    });

    await ctrl.initialize();
    expect(ctrl.getState().activeConversation.selectedModel).toBe("gone-model");
    expect(ctrl.getState().modelUnavailable).toBe(true);

    await expect(ctrl.sendUserMessage("Hola")).rejects.toThrow(
      "ai_model_unavailable",
    );
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("flushes pending edits before sending, streams SSE progress/proposal, and handles continuation", async () => {
    const order = [];
    const api = {
      listModels: vi.fn(async () => protocolFixture.catalog),
      listConversations: vi.fn(async () => ({
        items: [
          {
            id: protocolFixture.proposal.conversationId,
            projectId: "p1",
            selectedModel: "chat-a",
            title: "Schema audit",
            updatedAt: "2026-10-26T12:00:00.000Z",
            activeGenerationId: null,
          },
        ],
        nextCursor: null,
      })),
      listMessages: vi.fn(async () => ({
        items: [],
        proposals: [],
        nextCursor: null,
      })),
      sendMessage: vi.fn(async (_pid, _cid, payload) => {
        order.push(["sendMessage", payload]);
        return { generationId: "gen-1" };
      }),
      subscribeGenerationEvents: vi.fn(async (_pid, _gid, { onEvent }) => {
        order.push(["subscribe"]);
        onEvent({
          id: 1,
          event: "generation",
          data: {
            generationId: "gen-1",
            messageId: "msg-a1",
            requestedModel: "chat-a",
          },
        });
        onEvent({
          id: 2,
          event: "progress",
          data: { reviewed: 25, remaining: 175, scope: null, baseVersion: 4 },
        });
        onEvent({ id: 3, event: "text", data: { delta: "Analizando..." } });
        onEvent({
          id: 4,
          event: "proposal",
          data: { proposalId: protocolFixture.proposal.id, revision: 1 },
        });
        onEvent({
          id: 5,
          event: "done",
          data: {
            messageId: "msg-a1",
            proposalId: protocolFixture.proposal.id,
            continuation: "cursor-page-2",
          },
        });
        return { lastEventId: 5 };
      }),
      getProposal: vi.fn(async () => ({
        proposal: { ...protocolFixture.proposal, baseVersion: 4 },
        before: { tables: [] },
        after: { tables: [] },
        stale: false,
      })),
    };

    const waitForAckedVersion = vi.fn(async () => {
      order.push(["waitForAckedVersion"]);
      return { version: 4, doc: { tables: [] } };
    });

    const ctrl = createAiController({
      projectId: "p1",
      api,
      waitForAckedVersion,
    });

    await ctrl.initialize();
    expect(AI_MAX_MESSAGE_LENGTH).toBe(8000);
    await expect(
      ctrl.sendUserMessage("x".repeat(AI_MAX_MESSAGE_LENGTH + 1)),
    ).rejects.toThrow("invalid_input");

    await ctrl.sendUserMessage("Revisa el esquema");
    expect(order[0]).toEqual(["waitForAckedVersion"]);
    expect(order[1][0]).toBe("sendMessage");
    expect(order[2]).toEqual(["subscribe"]);

    const state = ctrl.getState();
    expect(state.continuation).toBe("cursor-page-2");
    expect(state.activeProposal?.id).toBe(protocolFixture.proposal.id);

    await ctrl.continueAnalysis();
    expect(api.sendMessage).toHaveBeenLastCalledWith(
      "p1",
      protocolFixture.proposal.conversationId,
      expect.objectContaining({ continuation: "cursor-page-2" }),
    );
  });

  it("marks pending proposal stale when version advances and cleans up on restored/role_changed/exit", async () => {
    const endPreview = vi.fn();
    const api = {
      listModels: vi.fn(async () => protocolFixture.catalog),
      listConversations: vi.fn(async () => ({
        items: [
          {
            id: protocolFixture.proposal.conversationId,
            projectId: "p1",
            selectedModel: "chat-a",
            title: "Audit",
            updatedAt: "2026-10-26T12:00:00.000Z",
            activeGenerationId: null,
          },
        ],
        nextCursor: null,
      })),
      listMessages: vi.fn(async () => ({
        items: [],
        proposals: [{ ...protocolFixture.proposal, baseVersion: 2 }],
        nextCursor: null,
      })),
    };

    const ctrl = createAiController({
      projectId: "p1",
      api,
      endPreview,
      initialRole: "editor",
      initialVersion: 2,
    });

    await ctrl.initialize();
    expect(ctrl.getState().activeProposal.stale).toBe(false);
    expect(ctrl.getState().canEdit).toBe(true);

    ctrl.syncCollabState({ version: 3, role: "editor", lastRestoredAt: 0 });
    expect(ctrl.getState().activeProposal.stale).toBe(true);

    ctrl.syncCollabState({ version: 3, role: "viewer", lastRestoredAt: 0 });
    expect(ctrl.getState().canEdit).toBe(false);

    ctrl.syncCollabState({
      version: 4,
      role: "editor",
      lastRestoredAt: 1700000000,
    });
    expect(endPreview).toHaveBeenCalled();

    ctrl.handleProjectExit("access_revoked");
    expect(ctrl.getState().disposed).toBe(true);

    expect(mapAiErrorCode("ai_stale_proposal")).toBe("ai_error_stale_proposal");
    expect(mapAiErrorCode("ai_limit")).toBe("ai_error_limit");
  });

  it("recovers applied proposal state when applyProposal HTTP response is lost and ignores version advance while applying", async () => {
    const endPreview = vi.fn();
    let ctrl;
    const api = {
      listModels: vi.fn(async () => protocolFixture.catalog),
      listConversations: vi.fn(async () => ({
        items: [
          {
            id: protocolFixture.proposal.conversationId,
            projectId: "p1",
            selectedModel: "chat-a",
            title: "Audit",
            updatedAt: "2026-10-26T12:00:00.000Z",
            activeGenerationId: null,
          },
        ],
        nextCursor: null,
      })),
      listMessages: vi.fn(async () => ({
        items: [],
        proposals: [{ ...protocolFixture.proposal, baseVersion: 2 }],
        nextCursor: null,
      })),
      applyProposal: vi.fn(async () => {
        // Remote Socket.IO ops arrive while HTTP applyProposal is in flight
        ctrl.syncCollabState({ version: 3, role: "editor", lastRestoredAt: 0 });
        expect(ctrl.getState().activeProposal?.stale).toBe(false);
        // Simulate lost HTTP response / network drop after server committed
        throw new Error("network_disconnected");
      }),
      getProposal: vi.fn(async () => ({
        proposal: {
          ...protocolFixture.proposal,
          baseVersion: 2,
          status: "applied",
          appliedVersion: 3,
          snapshotId: "snap-recovered",
        },
        before: { tables: [] },
        after: { tables: [] },
        stale: false,
      })),
    };

    ctrl = createAiController({
      projectId: "p1",
      api,
      endPreview,
      initialRole: "editor",
      initialVersion: 2,
    });

    await ctrl.initialize();
    const res = await ctrl.acceptProposal(protocolFixture.proposal.id);
    expect(res).toEqual({
      proposalId: protocolFixture.proposal.id,
      revision: protocolFixture.proposal.revision,
      version: 3,
      snapshotId: "snap-recovered",
      applied: true,
    });
    expect(endPreview).toHaveBeenCalled();
    expect(ctrl.getState().activeProposal).toBeNull();
    expect(ctrl.getState().version).toBe(3);
  });
});

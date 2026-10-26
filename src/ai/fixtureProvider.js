import protocolFixture from "./__fixtures__/protocol.json";
import {
  createSyntheticDiagram,
  createSyntheticProposalFixture,
} from "./syntheticFixtures";
import { ProjectSession } from "../collab/ProjectSession";
import { applyOps } from "../collab/ops";

export function createFixtureAiEnvironment({
  projectId = "proj-synthetic",
  tableCount = 200,
  changeCount = 60,
} = {}) {
  let currentDoc = createSyntheticDiagram(tableCount);
  let currentVersion = 1;
  let seqId = 1;
  const peers = [];
  const conversations = new Map();
  const messagesByConv = new Map();
  const proposalsById = new Map();
  const generationsById = new Map();
  const historyItems = [];

  const broadcastOps = (ops, nextVersion) => {
    for (const p of peers) {
      p.receive("ops", { version: nextVersion, ops });
    }
  };

  const simulateConcurrentEdit = (op) => {
    const applied = applyOps(currentDoc, [op]);
    if (!applied.ok) return currentVersion;
    currentDoc = applied.doc;
    currentVersion += 1;
    broadcastOps([op], currentVersion);
    return currentVersion;
  };

  const createApiForPeer = (peer) => ({
    listModels: async () => ({
      ...protocolFixture.catalog,
      items: protocolFixture.catalog.items.map((m) => ({ ...m })),
    }),

    listConversations: async () => ({
      items: Array.from(conversations.values()).filter(
        (c) => c.ownerId === peer.userId && c.projectId === projectId,
      ),
      nextCursor: null,
    }),

    createConversation: async (_pid, { selectedModel } = {}) => {
      const conv = {
        id: `conv-${seqId++}`,
        projectId,
        ownerId: peer.userId,
        selectedModel: selectedModel ?? protocolFixture.catalog.defaultModel,
        title: `Conversación #${seqId - 1}`,
        updatedAt: new Date().toISOString(),
        activeGenerationId: null,
      };
      conversations.set(conv.id, conv);
      messagesByConv.set(conv.id, []);
      return { ...conv };
    },

    updateConversation: async (_pid, cid, { selectedModel }) => {
      const conv = conversations.get(cid);
      if (!conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      if (conv.activeGenerationId) {
        throw new Error("ai_busy");
      }
      conv.selectedModel = selectedModel;
      conv.updatedAt = new Date().toISOString();
      return { ...conv };
    },

    deleteConversation: async (_pid, cid) => {
      const conv = conversations.get(cid);
      if (!conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      conversations.delete(cid);
      messagesByConv.delete(cid);
    },

    listMessages: async (_pid, cid) => {
      const conv = conversations.get(cid);
      if (!conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      const items = messagesByConv.get(cid) ?? [];
      const proposals = Array.from(proposalsById.values())
        .filter((p) => p.proposal.conversationId === cid)
        .map((p) => p.proposal);
      return { items: [...items], proposals, nextCursor: null };
    },

    sendMessage: async (_pid, cid, { content }) => {
      const conv = conversations.get(cid);
      if (!conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      const userMsg = {
        id: `msg-${seqId++}`,
        role: "user",
        content,
        status: "complete",
        requestedModel: conv.selectedModel,
        reportedModel: null,
        usage: null,
        createdAt: new Date().toISOString(),
      };
      const assistantMsg = {
        id: `msg-${seqId++}`,
        role: "assistant",
        content: "Propuesta preparada tras revisar el esquema por páginas.",
        status: "complete",
        requestedModel: conv.selectedModel,
        reportedModel: `fixture-${conv.selectedModel}`,
        usage: { totalTokens: 512 },
        createdAt: new Date().toISOString(),
      };
      const existingProposals = Array.from(proposalsById.values()).filter(
        (p) => p.proposal.conversationId === cid,
      );
      for (const prev of existingProposals) {
        if (prev.proposal.status === "pending") {
          prev.proposal.status = "superseded";
        }
      }
      const revision = existingProposals.length + 1;
      const proposalId = `prop-${seqId++}`;
      const fixture = createSyntheticProposalFixture(currentDoc, {
        changeCount,
        proposalId,
        conversationId: cid,
        revision,
        baseVersion: currentVersion,
      });
      proposalsById.set(proposalId, fixture);

      const list = messagesByConv.get(cid) ?? [];
      list.push(userMsg, assistantMsg);
      messagesByConv.set(cid, list);

      const generationId = `gen-${seqId++}`;
      generationsById.set(generationId, {
        id: generationId,
        ownerId: peer.userId,
        conversationId: cid,
        messageId: assistantMsg.id,
        requestedModel: conv.selectedModel,
        proposalId,
        revision,
      });
      return { generationId };
    },

    subscribeGenerationEvents: async (_pid, gid, { onEvent }) => {
      const gen = generationsById.get(gid);
      if (!gen || gen.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      const pageSize = 25;
      const total = currentDoc.tables.length;
      let eventId = 1;
      onEvent?.({
        id: eventId++,
        event: "generation",
        data: {
          generationId: gen.id,
          messageId: gen.messageId,
          requestedModel: gen.requestedModel,
        },
      });
      onEvent?.({
        id: eventId++,
        event: "progress",
        data: {
          reviewed: Math.min(pageSize, total),
          remaining: Math.max(0, total - pageSize),
          scope: null,
          baseVersion: currentVersion,
        },
      });
      onEvent?.({
        id: eventId++,
        event: "text",
        data: {
          delta: "Propuesta preparada tras revisar el esquema por páginas.",
        },
      });
      onEvent?.({
        id: eventId++,
        event: "proposal",
        data: { proposalId: gen.proposalId, revision: gen.revision },
      });
      onEvent?.({
        id: eventId++,
        event: "done",
        data: {
          messageId: gen.messageId,
          proposalId: gen.proposalId,
          continuation: null,
        },
      });
      return { recoveredFromCanonical: false, lastEventId: eventId - 1 };
    },

    getProposal: async (_pid, proposalId) => {
      const entry = proposalsById.get(proposalId);
      const conv = entry
        ? conversations.get(entry.proposal.conversationId)
        : null;
      if (!entry || !conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      const stale = currentVersion !== entry.proposal.baseVersion;
      return {
        proposal: { ...entry.proposal },
        before: entry.before,
        after: entry.after,
        stale,
      };
    },

    applyProposal: async (_pid, proposalId, { revision }) => {
      if (!["admin", "editor"].includes(peer.role)) {
        throw new Error("forbidden");
      }
      const entry = proposalsById.get(proposalId);
      const conv = entry
        ? conversations.get(entry.proposal.conversationId)
        : null;
      if (!entry || !conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      if (
        entry.proposal.revision !== revision ||
        currentVersion !== entry.proposal.baseVersion
      ) {
        throw new Error("ai_stale_proposal");
      }

      const snapId = `snap-pre-ai-${seqId++}`;
      historyItems.unshift({
        id: snapId,
        kind: "pre_ai_apply",
        name: null,
        createdAt: new Date().toISOString(),
        createdBy: { id: peer.userId, name: peer.name },
        authors: [{ id: peer.userId, name: peer.name }],
      });

      const applied = applyOps(currentDoc, entry.ops);
      currentDoc = applied.doc;
      currentVersion += 1;
      entry.proposal.status = "applied";
      entry.proposal.appliedVersion = currentVersion;
      entry.proposal.snapshotId = snapId;

      broadcastOps(entry.ops, currentVersion);
      return {
        proposalId,
        revision,
        version: currentVersion,
        snapshotId: snapId,
        applied: true,
      };
    },

    discardProposal: async (_pid, proposalId) => {
      const entry = proposalsById.get(proposalId);
      const conv = entry
        ? conversations.get(entry.proposal.conversationId)
        : null;
      if (!entry || !conv || conv.ownerId !== peer.userId) {
        throw new Error("not_found");
      }
      entry.proposal.status = "discarded";
    },
  });

  const connectPeer = ({ userId, name, role = "editor" }) => {
    const listeners = new Map();
    const sent = [];
    let canvasDoc = currentDoc;

    const socket = {
      on: (ev, fn) => listeners.set(ev, fn),
      off: (ev) => listeners.delete(ev),
      connect() {},
      disconnect() {},
      emit: (event, payload, ackFn) => {
        sent.push([event, payload]);
        if (event === "join" && typeof ackFn === "function") {
          ackFn({
            ok: true,
            doc: currentDoc,
            version: currentVersion,
            epoch: 1,
            role,
            name: "Synthetic Project",
            peers: [],
          });
        } else if (event === "ops") {
          const applied = applyOps(currentDoc, payload.ops);
          if (applied.ok) {
            currentDoc = applied.doc;
            currentVersion += 1;
            listeners.get("ack")?.({
              seq: payload.seq,
              version: currentVersion,
              ok: true,
            });
            for (const other of peers) {
              if (other.userId !== userId) {
                other.receive("ops", {
                  version: currentVersion,
                  ops: payload.ops,
                });
              }
            }
          }
        }
      },
      volatile: { emit: (...args) => sent.push(args) },
    };

    const session = new ProjectSession({
      projectId,
      socket,
      onState: () => {},
      onExit: () => {},
      onNotice: () => {},
    });
    session.registerAppliers((next) => {
      canvasDoc = next;
    });
    session.start();
    listeners.get("connect")?.();
    const initial = session.hydrate();
    canvasDoc = initial;
    session.observe(initial);

    const peerObj = {
      userId,
      name,
      role,
      session,
      receive: (ev, payload) => listeners.get(ev)?.(payload),
      getCanvasDoc: () => canvasDoc,
      getSentOpsCount: () => sent.filter(([e]) => e === "ops").length,
    };
    peerObj.api = createApiForPeer(peerObj);
    peers.push(peerObj);
    return peerObj;
  };

  return {
    projectId,
    connectPeer,
    simulateConcurrentEdit,
    getVersion: () => currentVersion,
    getDoc: () => currentDoc,
    getHistoryItems: () => [...historyItems],
  };
}

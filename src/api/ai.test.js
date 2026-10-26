import { describe, expect, it, vi } from "vitest";
import protocolFixture from "../ai/__fixtures__/protocol.json";
import { http } from "./http";
import * as aiApi from "./ai";

function createSseStream(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i < chunks.length) c.enqueue(encoder.encode(chunks[i++]));
      else c.close();
    },
  });
}

describe("ai api client", () => {
  it("calls all /projects/:id/ai/* HTTP endpoints with expected methods and payloads", async () => {
    const getSpy = vi
      .spyOn(http, "get")
      .mockImplementation(async (url, cfg) => ({
        data: { url, params: cfg?.params },
      }));
    const postSpy = vi
      .spyOn(http, "post")
      .mockImplementation(async (url, body) => ({ data: { url, body } }));
    const patchSpy = vi
      .spyOn(http, "patch")
      .mockImplementation(async (url, body) => ({ data: { url, body } }));
    const deleteSpy = vi
      .spyOn(http, "delete")
      .mockImplementation(async (url) => ({ data: { url } }));

    expect(await aiApi.listModels("p1")).toEqual({
      url: "/projects/p1/ai/models",
      params: undefined,
    });
    expect(await aiApi.listModels("p1", { refresh: true })).toEqual({
      url: "/projects/p1/ai/models",
      params: { refresh: 1 },
    });
    expect(
      await aiApi.listConversations("p1", { cursor: "c1", limit: 20 }),
    ).toEqual({
      url: "/projects/p1/ai/conversations",
      params: { cursor: "c1", limit: 20 },
    });
    expect(
      await aiApi.createConversation("p1", { selectedModel: "chat-a" }),
    ).toEqual({
      url: "/projects/p1/ai/conversations",
      body: { selectedModel: "chat-a" },
    });
    expect(
      await aiApi.updateConversation("p1", "c-1", { selectedModel: "chat-b" }),
    ).toEqual({
      url: "/projects/p1/ai/conversations/c-1",
      body: { selectedModel: "chat-b" },
    });
    await aiApi.deleteConversation("p1", "c-1");
    expect(deleteSpy).toHaveBeenCalledWith("/projects/p1/ai/conversations/c-1");
    expect(
      await aiApi.listMessages("p1", "c-1", { cursor: "m1", limit: 50 }),
    ).toEqual({
      url: "/projects/p1/ai/conversations/c-1/messages",
      params: { cursor: "m1", limit: 50 },
    });
    expect(
      await aiApi.sendMessage("p1", "c-1", {
        content: "Analiza",
        requestId: "r-1",
        continuation: "k-1",
      }),
    ).toEqual({
      url: "/projects/p1/ai/conversations/c-1/messages",
      body: { content: "Analiza", requestId: "r-1", continuation: "k-1" },
    });
    expect(await aiApi.getGeneration("p1", "g-1")).toEqual({
      url: "/projects/p1/ai/generations/g-1",
      params: undefined,
    });
    await aiApi.cancelGeneration("p1", "g-1");
    expect(postSpy).toHaveBeenCalledWith("/projects/p1/ai/generations/g-1/cancel");
    expect(await aiApi.getProposal("p1", "pr-1")).toEqual({
      url: "/projects/p1/ai/proposals/pr-1",
      params: undefined,
    });
    expect(await aiApi.applyProposal("p1", "pr-1", { revision: 2 })).toEqual({
      url: "/projects/p1/ai/proposals/pr-1/apply",
      body: { revision: 2 },
    });
    await aiApi.discardProposal("p1", "pr-1");
    expect(postSpy).toHaveBeenCalledWith("/projects/p1/ai/proposals/pr-1/discard");

    getSpy.mockRestore();
    postSpy.mockRestore();
    patchSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  it("streams SSE events from protocol.json, ignores heartbeats, and sends Last-Event-ID", async () => {
    const sseFrames = [
      ": heartbeat\n\n",
      ...protocolFixture.events.map(
        (ev) =>
          `id: ${ev.id}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`,
      ),
    ];
    const fetchMock = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      body: createSseStream(sseFrames),
      url,
      init,
    }));
    const received = [];
    const result = await aiApi.subscribeGenerationEvents(
      "proj-1",
      "0199aaaa-0000-7000-8000-000000000003",
      {
        lastEventId: 1,
        fetchImpl: fetchMock,
        onEvent: (ev) => received.push(ev),
      },
    );
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      "/api/projects/proj-1/ai/generations/0199aaaa-0000-7000-8000-000000000003/events",
    );
    expect(calledInit.credentials).toBe("include");
    expect(calledInit.headers["Last-Event-ID"]).toBe("1");
    expect(received).toEqual(protocolFixture.events);
    expect(result.lastEventId).toBe(3);
  });

  it("falls back to canonical state when SSE replay buffer fails", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 410 }));
    const getSpy = vi.spyOn(http, "get").mockImplementation(async (url) => {
      if (url.endsWith("/generations/gen-gap")) {
        return {
          data: {
            id: "gen-gap",
            status: "complete",
            messageId: "msg-gap",
            proposalId: protocolFixture.proposal.id,
            error: null,
            continuation: null,
          },
        };
      }
      return {
        data: {
          items: [{ id: "msg-gap", role: "assistant", content: "Canónico." }],
          proposals: [protocolFixture.proposal],
          nextCursor: null,
        },
      };
    });

    const recovered = await aiApi.subscribeGenerationEvents("proj-1", "gen-gap", {
      conversationId: "conv-gap",
      lastEventId: 99,
      fetchImpl: fetchMock,
    });
    expect(recovered.recoveredFromCanonical).toBe(true);
    expect(recovered.generation.status).toBe("complete");
    expect(recovered.messages.items[0].content).toBe("Canónico.");
    getSpy.mockRestore();
  });
});

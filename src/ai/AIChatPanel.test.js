import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import protocolFixture from "./__fixtures__/protocol.json";

vi.hoisted(() => {
  globalThis.DOMRect ??= class DOMRect {};
});

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "aria-label": ariaLabel,
    "data-testid": testId,
  }) =>
    createElement(
      "button",
      { onClick, disabled, "aria-label": ariaLabel, "data-testid": testId },
      children,
    ),
  Input: ({ value, placeholder, onChange, "aria-label": ariaLabel }) =>
    createElement("input", {
      value: value ?? "",
      placeholder,
      onChange,
      "aria-label": ariaLabel,
    }),
  TextArea: ({ value, placeholder, onChange, "aria-label": ariaLabel }) =>
    createElement("textarea", {
      value: value ?? "",
      placeholder,
      onChange,
      "aria-label": ariaLabel,
    }),
  Select: Object.assign(
    ({ value, children, "aria-label": ariaLabel }) =>
      createElement(
        "select",
        { value: value ?? "", "aria-label": ariaLabel },
        children,
      ),
    {
      Option: ({ value, children }) =>
        createElement("option", { value }, children),
    },
  ),
  Modal: { confirm: vi.fn() },
  Spin: () => createElement("span", null, "loading"),
  Tag: ({ children }) => createElement("span", null, children),
  Toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) =>
      opts && typeof opts === "object"
        ? `${key}:${JSON.stringify(opts)}`
        : key,
  }),
}));

import ModelSelector from "./ModelSelector";
import AIChatPanel from "./AIChatPanel";

const manyChangesProposal = {
  ...protocolFixture.proposal,
  summary: {
    counts: { added: 20, modified: 35, removed: 5 },
    items: Array.from({ length: 60 }, (_, idx) => ({
      coll: "tables",
      id: `tbl_${idx}`,
      change: idx < 20 ? "added" : idx < 55 ? "modified" : "removed",
      beforeName: `old_table_${idx}`,
      afterName: `new_table_${idx}`,
      properties: ["name", "fields"],
    })),
  },
};

describe("ModelSelector & AIChatPanel", () => {
  it("renders catalog states: empty, error, stale, unknown capabilities, chat-only, and search filtering", () => {
    const emptyHtml = renderToStaticMarkup(
      createElement(ModelSelector, {
        catalog: { items: [], fetchedAt: null, stale: false, defaultModel: null },
        selectedModel: null,
        onSelectModel: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );
    expect(emptyHtml).toContain("ai_models_empty");

    const staleUnknownCatalog = {
      items: [
        ...protocolFixture.catalog.items,
        {
          id: "chat-unknown",
          label: "Unknown Caps Model",
          provider: "fixture",
          capabilities: { chat: true, tools: null, json: null, stream: null },
          contextWindow: 16000,
          maxOutputTokens: 1024,
        },
      ],
      fetchedAt: "2026-10-26T12:00:00.000Z",
      stale: true,
      defaultModel: "chat-a",
    };

    const chatOnlyHtml = renderToStaticMarkup(
      createElement(ModelSelector, {
        catalog: staleUnknownCatalog,
        selectedModel: "chat-b",
        initialSearch: "chat",
        onSelectModel: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );
    expect(chatOnlyHtml).toContain("ai_models_stale");
    expect(chatOnlyHtml).toContain("ai_model_chat_only");

    const unknownHtml = renderToStaticMarkup(
      createElement(ModelSelector, {
        catalog: staleUnknownCatalog,
        selectedModel: "chat-unknown",
        onSelectModel: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );
    expect(unknownHtml).toContain("ai_model_unknown_capabilities");

    const missingHtml = renderToStaticMarkup(
      createElement(ModelSelector, {
        catalog: staleUnknownCatalog,
        selectedModel: "disappeared-model",
        onSelectModel: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );
    expect(missingHtml).toContain("ai_model_unavailable_notice");
  });

  it("escapes malicious message content, shows model badge per response, progress, continuation, and paginated proposal for editor vs viewer", () => {
    const maliciousMessages = [
      {
        id: "m1",
        role: "user",
        content: '<script>window.__xss = 1</script><img src=x onerror="alert(1)">',
        status: "complete",
        requestedModel: "chat-a",
        reportedModel: null,
        createdAt: "2026-10-26T12:00:00.000Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: 'Respuesta segura con <a href="javascript:alert(1)">link</a>',
        status: "complete",
        requestedModel: "chat-a",
        reportedModel: "fixture-chat-a",
        createdAt: "2026-10-26T12:01:00.000Z",
      },
    ];

    const editorHtml = renderToStaticMarkup(
      createElement(AIChatPanel, {
        initialOpen: true,
        role: "editor",
        initialState: {
          role: "editor",
          canEdit: true,
          catalog: protocolFixture.catalog,
          conversations: {
            items: [
              {
                id: protocolFixture.proposal.conversationId,
                projectId: "p1",
                selectedModel: "chat-a",
                title: "Auditoría",
                updatedAt: "2026-10-26T12:00:00.000Z",
              },
            ],
            nextCursor: null,
            loading: false,
          },
          activeConversationId: protocolFixture.proposal.conversationId,
          activeConversation: {
            id: protocolFixture.proposal.conversationId,
            projectId: "p1",
            selectedModel: "chat-a",
            title: "Auditoría",
          },
          messages: { items: maliciousMessages, nextCursor: null, loading: false },
          activeProposal: { ...manyChangesProposal, stale: false },
          generation: {
            active: true,
            id: "gen-1",
            messageId: "m2",
            requestedModel: "chat-a",
            progress: { reviewed: 50, remaining: 150, scope: null, baseVersion: 1 },
          },
          continuation: "next-token",
        },
      }),
    );

    expect(editorHtml).not.toContain("<script>");
    expect(editorHtml).toContain("&lt;script&gt;window.__xss = 1&lt;/script&gt;");
    expect(editorHtml).toContain("fixture-chat-a");
    expect(editorHtml).toContain("ai_private_notice");
    expect(editorHtml).toContain("ai_progress_status");
    expect(editorHtml).toContain("ai_cancel_generation");
    expect(editorHtml).toContain("ai_continue_analysis");
    expect(editorHtml).toContain("ai_proposal_accept");
    expect(editorHtml).toContain("ai_proposal_discard");
    expect(editorHtml).toContain("ai_proposal_preview");
    expect(editorHtml).toContain("new_table_0");
    expect(editorHtml).toContain("new_table_24");
    expect(editorHtml).not.toContain("new_table_25");

    const viewerHtml = renderToStaticMarkup(
      createElement(AIChatPanel, {
        initialOpen: true,
        role: "viewer",
        initialState: {
          role: "viewer",
          canEdit: false,
          catalog: protocolFixture.catalog,
          conversations: { items: [], nextCursor: null, loading: false },
          messages: { items: maliciousMessages, nextCursor: null, loading: false },
          activeProposal: { ...manyChangesProposal, stale: true },
          generation: { active: false, progress: null },
        },
      }),
    );

    expect(viewerHtml).toContain("ai_viewer_readonly_notice");
    expect(viewerHtml).not.toContain("ai_proposal_accept");
    expect(viewerHtml).toContain("ai_proposal_stale_warning");
  });
});

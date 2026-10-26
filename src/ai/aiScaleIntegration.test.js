import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_SIZES,
  createSyntheticDiagram,
  createSyntheticProposalFixture,
} from "./syntheticFixtures";
import { createFixtureAiEnvironment } from "./fixtureProvider";
import { createAiController, paginateChangeItems } from "./aiState";
import { buildProposalMarkers } from "./proposalMarkers";
import { ProjectCollabContext } from "../collab/ProjectCollabProvider";
import HistoryPanel from "../collab/HistoryPanel";
import PreviewBanner from "../collab/PreviewBanner";
import ProposalPreviewLayer from "./ProposalPreviewLayer";
import AIChatPanel from "./AIChatPanel";

vi.hoisted(() => {
  globalThis.DOMRect ??= class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.left = x;
      this.top = y;
      this.width = width;
      this.height = height;
    }
  };
});

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    "data-testid": testId,
    "aria-label": ariaLabel,
  }) =>
    createElement(
      "button",
      { onClick, disabled, "data-testid": testId, "aria-label": ariaLabel },
      children,
    ),
  Dropdown: Object.assign(
    ({ children, render }) =>
      createElement("div", { "data-dropdown": "true" }, children, render),
    {
      Menu: ({ children }) => createElement("div", null, children),
      Item: ({ children, onClick }) =>
        createElement("button", { onClick }, children),
    },
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
  Modal: Object.assign(
    ({ visible, title, children }) =>
      visible ? createElement("div", { "data-modal": title }, children) : null,
    { confirm: vi.fn() },
  ),
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

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

describe("Task 10 — AI E2E Integration & 200/500/1000 Scale Suite", () => {
  it("executes full E2E flow: catalog, model switch, private user isolation, batched progress, preview, apply, collaborative broadcast, pre_ai_apply history, and stale rejection", async () => {
    const env = createFixtureAiEnvironment({ tableCount: 200 });
    const editorPeer = env.connectPeer({
      userId: "u-editor",
      name: "Carlos",
      role: "editor",
    });
    const viewerPeer = env.connectPeer({
      userId: "u-viewer",
      name: "Ana",
      role: "viewer",
    });

    const editorCtrl = createAiController({
      projectId: env.projectId,
      api: editorPeer.api,
      waitForAckedVersion: editorPeer.session.waitForAckedVersion,
      startAiPreview: ({ proposal, before, after, stale }) =>
        editorPeer.session.startPreview(after, {
          kind: "ai",
          id: proposal.id,
          proposal,
          before,
          after,
          stale,
        }),
      endPreview: editorPeer.session.endPreview,
      initialRole: "editor",
      initialVersion: env.getVersion(),
    });

    const viewerCtrl = createAiController({
      projectId: env.projectId,
      api: viewerPeer.api,
      waitForAckedVersion: viewerPeer.session.waitForAckedVersion,
      endPreview: viewerPeer.session.endPreview,
      initialRole: "viewer",
      initialVersion: env.getVersion(),
    });

    await editorCtrl.initialize();
    await viewerCtrl.initialize();

    await editorCtrl.startNewConversation("chat-a");
    await editorCtrl.changeModel("chat-b");
    expect(editorCtrl.getState().activeConversation.selectedModel).toBe("chat-b");
    await editorCtrl.changeModel("chat-a");
    expect(editorCtrl.getState().activeConversation.selectedModel).toBe("chat-a");

    const viewerConvs = await viewerPeer.api.listConversations(env.projectId);
    expect(viewerConvs.items).toHaveLength(0);
    await expect(
      viewerPeer.api.listMessages(
        env.projectId,
        editorCtrl.getState().activeConversationId,
      ),
    ).rejects.toThrow("not_found");

    await editorCtrl.sendUserMessage(
      "Agrega tablas de auditoría y documenta el esquema",
    );
    const editorState = editorCtrl.getState();
    expect(editorState.activeProposal).not.toBeNull();
    expect(
      editorState.activeProposal.summary.items.length,
    ).toBeGreaterThanOrEqual(60);

    await expect(
      viewerPeer.api.applyProposal(
        env.projectId,
        editorState.activeProposal.id,
        { revision: 1 },
      ),
    ).rejects.toThrow("forbidden");

    await editorCtrl.openProposalPreview(editorState.activeProposal.id);
    expect(editorPeer.session.canWrite()).toBe(false);

    env.simulateConcurrentEdit({
      t: "add",
      coll: "notes",
      item: {
        id: "concurrent-note",
        title: "Concurrent",
        content: "x",
        x: 0,
        y: 0,
      },
      index: 0,
    });
    editorCtrl.syncCollabState({
      version: env.getVersion(),
      role: "editor",
      lastRestoredAt: 0,
    });
    expect(editorCtrl.getState().activeProposal.stale).toBe(true);
    await expect(
      editorCtrl.acceptProposal(editorState.activeProposal.id),
    ).rejects.toThrow("ai_stale_proposal");

    await editorCtrl.regenerateProposal();
    const freshProposal = editorCtrl.getState().activeProposal;
    expect(freshProposal.stale).toBe(false);
    expect(freshProposal.revision).toBe(2);

    await editorCtrl.openProposalPreview(freshProposal.id);
    await editorCtrl.acceptProposal(freshProposal.id);

    expect(viewerPeer.getCanvasDoc().tables.length).toBe(202);
    expect(editorPeer.getSentOpsCount()).toBe(0);

    const historyItems = env.getHistoryItems();
    expect(historyItems.some((h) => h.kind === "pre_ai_apply")).toBe(true);

    const historyHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: env.projectId,
            role: "editor",
            peers: [],
            preview: null,
            lastRestoredAt: 0,
          },
        },
        createElement(HistoryPanel, { initialItems: historyItems }),
      ),
    );
    expect(historyHtml).toContain("history_kind_pre_ai_apply");
  });

  it("verifies 5 warm runs at 200, 500, and 1000 tables with >50 proposal changes without UI degradation", () => {
    const viewBox = { left: 0, top: 0, width: 1600, height: 900 };
    for (const size of SYNTHETIC_SIZES) {
      const baseDoc = createSyntheticDiagram(size);
      const fixture = createSyntheticProposalFixture(baseDoc, {
        changeCount: 60,
      });

      buildProposalMarkers(fixture, { viewBox, zoom: 0.2 });
      paginateChangeItems(fixture.proposal.summary.items, 1, 25);

      const markerSamples = [];
      const renderSamples = [];

      for (let r = 0; r < 5; r++) {
        const m0 = performance.now();
        const culled = buildProposalMarkers(fixture, { viewBox, zoom: 0.2 });
        markerSamples.push(performance.now() - m0);
        expect(culled.simplified).toBe(true);

        const r0 = performance.now();
        const html = renderToStaticMarkup(
          createElement(
            ProjectCollabContext.Provider,
            {
              value: {
                projectId: `p-${size}`,
                role: "editor",
                preview: {
                  kind: "ai",
                  id: fixture.proposal.id,
                  proposal: fixture.proposal,
                  before: fixture.before,
                  after: fixture.after,
                  stale: false,
                },
              },
            },
            createElement(
              "div",
              null,
              createElement(PreviewBanner),
              createElement(
                "svg",
                null,
                createElement(ProposalPreviewLayer, { viewBox, zoom: 0.2 }),
              ),
              createElement(AIChatPanel, {
                initialOpen: true,
                role: "editor",
                initialState: {
                  role: "editor",
                  canEdit: true,
                  catalog: { items: [], defaultModel: null },
                  conversations: { items: [], nextCursor: null },
                  messages: { items: [], nextCursor: null },
                  activeProposal: fixture.proposal,
                  generation: { active: false, progress: null },
                },
              }),
            ),
          ),
        );
        renderSamples.push(performance.now() - r0);
        expect(html).toContain("ai-preview-banner");
        expect(html).toContain("ai-proposal-markers");
      }

      expect(median(markerSamples)).toBeLessThan(20);
      expect(median(renderSamples)).toBeLessThan(50);
    }
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSyntheticDiagram,
  createSyntheticProposalFixture,
} from "./syntheticFixtures";
import { ProjectSession } from "../collab/ProjectSession";
import { ProjectCollabContext } from "../collab/ProjectCollabProvider";
import PreviewBanner from "../collab/PreviewBanner";
import { createAiController } from "./aiState";
import { buildProposalMarkers, locateProposalItem } from "./proposalMarkers";
import ProposalPreviewLayer from "./ProposalPreviewLayer";

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
  Modal: { confirm: vi.fn() },
  Toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) =>
      opts && typeof opts === "object"
        ? `${key}:${JSON.stringify(opts)}`
        : key,
  }),
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("proposalMarkers & ProposalPreviewLayer", () => {
  it("computes added, modified, and removed ghost markers, culls to viewBox, and adapts to zoom", () => {
    const baseDoc = createSyntheticDiagram(200);
    const fixture = createSyntheticProposalFixture(baseDoc, {
      changeCount: 30,
    });

    const allMarkers = buildProposalMarkers(fixture, {
      viewBox: null,
      zoom: 1,
    });
    expect(allMarkers.simplified).toBe(false);
    expect(allMarkers.markers.some((m) => m.change === "added")).toBe(true);
    expect(allMarkers.markers.some((m) => m.change === "modified")).toBe(true);
    expect(allMarkers.ghosts.some((g) => g.change === "removed")).toBe(true);

    const culled = buildProposalMarkers(fixture, {
      viewBox: { left: 0, top: 0, width: 600, height: 400 },
      zoom: 0.15,
    });
    expect(culled.simplified).toBe(true);
    expect(culled.markers.length).toBeLessThan(allMarkers.markers.length);

    const addedItem = fixture.proposal.summary.items.find(
      (i) => i.change === "added",
    );
    const removedItem = fixture.proposal.summary.items.find(
      (i) => i.change === "removed",
    );
    const addedLoc = locateProposalItem(addedItem, fixture, 0.2);
    const removedLoc = locateProposalItem(removedItem, fixture, 0.8);
    expect(Number.isFinite(addedLoc.pan.x)).toBe(true);
    expect(addedLoc.zoom).toBeGreaterThanOrEqual(0.5);
    expect(Number.isFinite(removedLoc.pan.x)).toBe(true);
    expect(removedLoc.zoom).toBe(0.8);
  });

  it("discriminates History vs AI preview in PreviewBanner and ProposalPreviewLayer", () => {
    const baseDoc = createSyntheticDiagram(20);
    const fixture = createSyntheticProposalFixture(baseDoc, { changeCount: 6 });

    const historyBannerHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "editor",
            preview: {
              kind: "history",
              id: "snap-1",
              createdAt: "2026-10-26T10:00:00.000Z",
            },
            endPreview: vi.fn(),
          },
        },
        createElement(PreviewBanner),
      ),
    );
    expect(historyBannerHtml).toContain("history_preview_banner");
    expect(historyBannerHtml).toContain("history_restore");
    expect(historyBannerHtml).not.toContain("ai_preview_banner");

    const aiBannerHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "editor",
            preview: {
              kind: "ai",
              id: fixture.proposal.id,
              proposal: fixture.proposal,
              before: fixture.before,
              after: fixture.after,
              stale: false,
            },
            endPreview: vi.fn(),
          },
        },
        createElement(PreviewBanner),
      ),
    );
    expect(aiBannerHtml).toContain("ai_preview_banner");
    expect(aiBannerHtml).toContain("ai_proposal_accept");
    expect(aiBannerHtml).toContain("ai_proposal_discard");
    expect(aiBannerHtml).not.toContain("history_restore");

    const staleViewerAiBannerHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "viewer",
            preview: {
              kind: "ai",
              id: fixture.proposal.id,
              proposal: { ...fixture.proposal, stale: true },
              before: fixture.before,
              after: fixture.after,
              stale: true,
              onRegenerate: vi.fn(),
            },
            endPreview: vi.fn(),
          },
        },
        createElement(PreviewBanner),
      ),
    );
    expect(staleViewerAiBannerHtml).toContain("ai_preview_stale_banner");
    expect(staleViewerAiBannerHtml).not.toContain("ai_proposal_accept");
    expect(staleViewerAiBannerHtml).toContain("ai_proposal_regenerate");

    const layerHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
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
          "svg",
          null,
          createElement(ProposalPreviewLayer, { zoom: 1, viewBox: null }),
        ),
      ),
    );
    expect(layerHtml).toContain('data-testid="ai-proposal-markers"');
    expect(layerHtml).toContain('data-change="added"');
    expect(layerHtml).toContain('data-change="modified"');
    expect(layerHtml).toContain('data-change="removed"');
  });

  it("applies proposal via HTTP and remote ops without ever resending local ops", async () => {
    const baseDoc = createSyntheticDiagram(20);
    const fixture = createSyntheticProposalFixture(baseDoc, {
      changeCount: 8,
      baseVersion: 1,
    });

    const listeners = new Map();
    const sent = [];
    const socket = {
      on: (ev, fn) => listeners.set(ev, fn),
      off: (ev) => listeners.delete(ev),
      connect() {},
      disconnect() {},
      emit: (...args) => sent.push(args),
      volatile: { emit: (...args) => sent.push(args) },
    };
    const applied = [];
    const session = new ProjectSession({
      projectId: "p1",
      socket,
      onState: () => {},
      onExit: () => {},
      onNotice: () => {},
    });
    session.registerAppliers((next, previous, reset) =>
      applied.push({ next, previous, reset }),
    );
    session.start();
    listeners.get("connect")?.();
    sent.filter(([e]) => e === "join").at(-1)[2]({
      ok: true,
      doc: baseDoc,
      version: 1,
      epoch: 1,
      role: "editor",
      name: "P1",
      peers: [],
    });
    const initial = session.hydrate();
    session.observe(initial);

    const api = {
      listModels: vi.fn(async () => ({
        items: [
          {
            id: "chat-a",
            label: "Chat A",
            capabilities: { chat: true, tools: true },
          },
        ],
        defaultModel: "chat-a",
      })),
      listConversations: vi.fn(async () => ({ items: [], nextCursor: null })),
      getProposal: vi.fn(async () => fixture),
      applyProposal: vi.fn(async () => {
        listeners.get("ops")?.({ version: 2, ops: fixture.ops });
        return {
          proposalId: fixture.proposal.id,
          revision: 1,
          version: 2,
          snapshotId: "snap-ai-1",
          applied: true,
        };
      }),
    };

    const ctrl = createAiController({
      projectId: "p1",
      api,
      waitForAckedVersion: session.waitForAckedVersion,
      startAiPreview: ({ proposal, before, after, stale }) =>
        session.startPreview(after, {
          kind: "ai",
          id: proposal.id,
          proposal,
          before,
          after,
          stale,
        }),
      endPreview: session.endPreview,
      initialRole: "editor",
      initialVersion: 1,
    });

    await ctrl.initialize();
    await ctrl.openProposalPreview(fixture.proposal.id);
    expect(session.canWrite()).toBe(false);
    expect(session.state.preview.kind).toBe("ai");

    await ctrl.acceptProposal(fixture.proposal.id);
    expect(session.state.preview).toBeNull();
    expect(session.canWrite()).toBe(true);

    const currentCanvasDoc = applied.at(-1).next;
    session.observe(currentCanvasDoc);
    vi.advanceTimersByTime(200);

    expect(sent.filter(([e]) => e === "ops")).toHaveLength(0);
    expect(currentCanvasDoc.tables.length).toBe(fixture.after.tables.length);
  });
});

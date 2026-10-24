import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  globalThis.DOMRect ??= class DOMRect {};
});

const modalConfirmMock = vi.fn();
const toastErrorMock = vi.fn();
const toastInfoMock = vi.fn();

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, onClick }) =>
    createElement("button", { onClick }, children),
  Input: () => null,
  Modal: Object.assign(
    ({ visible, title, children }) =>
      visible ? createElement("div", { "data-modal": title }, children) : null,
    { confirm: (...args) => modalConfirmMock(...args) },
  ),
  Select: () => null,
  Toast: {
    error: (...args) => toastErrorMock(...args),
    info: (...args) => toastInfoMock(...args),
    success: vi.fn(),
  },
}));

const restoreMock = vi.fn();
vi.mock("../api/history", () => ({
  restore: (...args) => restoreMock(...args),
  get: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts?.time ? `${key}:${opts.time}` : key),
  }),
}));

import { AuthContext } from "../context/AuthContext";
import { CanvasContext } from "../context/CanvasContext";
import { TransformContext } from "../context/TransformContext";
import {
  ProjectCollabContext,
  normalizePreviewDoc,
} from "./ProjectCollabProvider";
import PresenceBar, { getInitials } from "./PresenceBar";
import PreviewBanner, { formatHistoryTime } from "./PreviewBanner";
import RemoteCursors, { normalizeLinking } from "./RemoteCursors";
import { throttle } from "./throttle";

describe("throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes at most 3 times for 10 calls in 100 ms with ms=50 and runs trailing call with last arguments", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 50);

    for (let i = 1; i <= 10; i++) {
      throttled({ x: i, y: i * 10 });
      vi.advanceTimersByTime(10);
    }
    vi.runAllTimers();

    expect(fn.mock.calls.length).toBeLessThanOrEqual(3);
    expect(fn).toHaveBeenLastCalledWith({ x: 10, y: 100 });
  });

  it("guarantees a trailing call with the latest arguments when burst calls happen within the window", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 50);

    throttled("first");
    throttled("second");
    throttled("third");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith("first");

    vi.advanceTimersByTime(50);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("third");
  });

  it("cancels a pending trailing call when cancel() is invoked", () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 50);

    throttled({ x: 1, y: 2 });
    throttled({ x: 3, y: 4 });
    expect(fn).toHaveBeenCalledTimes(1);

    throttled.cancel();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith({ x: 1, y: 2 });
  });
});

describe("RemoteCursors & PresenceBar", () => {
  it("renders remote cursors and remote linking line converted via toScreenSpace", () => {
    const awareness = new Map([
      [
        "u1",
        {
          name: "Ana",
          color: "#2563eb",
          cursor: { x: 10, y: 20 },
          linking: { startX: 5, startY: 15, endX: 25, endY: 35 },
        },
      ],
    ]);
    const canvasValue = {
      pointer: { spaces: { diagram: { x: 0, y: 0 } } },
      coords: {
        toScreenSpace: ({ x, y }) => ({ x: x * 2, y: y * 3 }),
      },
    };
    const html = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        { value: { awareness, sendAwareness: vi.fn() } },
        createElement(
          TransformContext.Provider,
          { value: { transform: { zoom: 2, pan: { x: 0, y: 0 } } } },
          createElement(
            CanvasContext.Provider,
            { value: canvasValue },
            createElement(RemoteCursors),
          ),
        ),
      ),
    );

    expect(html).toContain("pointer-events-none");
    expect(html).toContain("translate3d(20px, 60px, 0)");
    expect(html).toContain("Ana");
    expect(html).toContain("#2563eb");
    expect(html).toContain('x1="10"');
    expect(html).toContain('y1="45"');
    expect(html).toContain('x2="50"');
    expect(html).toContain('y2="105"');
    expect(
      normalizeLinking({ startX: 1, startY: 2, endX: 3, endY: 4 }),
    ).toEqual({ startX: 1, startY: 2, endX: 3, endY: 4 });
  });

  it("renders at most 8 peer avatars plus +N, status dot, and Members button only for admins", () => {
    const peers = Array.from({ length: 10 }, (_, i) => ({
      userId: `u${i + 1}`,
      name: `User ${i + 1}`,
      color: "#16a34a",
    }));

    const adminHtml = renderToStaticMarkup(
      createElement(
        AuthContext.Provider,
        { value: { user: { id: "u1", isAdmin: true } } },
        createElement(
          ProjectCollabContext.Provider,
          {
            value: {
              projectId: "p1",
              status: "online",
              role: "admin",
              peers,
            },
          },
          createElement(PresenceBar),
        ),
      ),
    );

    expect(getInitials("Ada Lovelace")).toBe("AL");
    expect(adminHtml).toContain("+2");
    expect(adminHtml).toContain("bg-emerald-500");
    expect(adminHtml).toContain("<button>members</button>");
    expect(
      (adminHtml.match(/data-testid="presence-avatar"/g) || []).length,
    ).toBe(8);

    const editorHtml = renderToStaticMarkup(
      createElement(
        AuthContext.Provider,
        { value: { user: { id: "u2", isAdmin: false } } },
        createElement(
          ProjectCollabContext.Provider,
          {
            value: {
              projectId: "p1",
              status: "offline",
              role: "editor",
              peers: peers.slice(0, 2),
            },
          },
          createElement(PresenceBar),
        ),
      ),
    );

    expect(editorHtml).toContain("bg-amber-500");
    expect(editorHtml).not.toContain("<button>members</button>");
    expect(editorHtml).not.toContain("presence-overflow");
  });

  it("RemoteCursors renders nothing when preview is active", () => {
    const awareness = new Map([
      ["u1", { name: "Ana", color: "#2563eb", cursor: { x: 10, y: 20 } }],
    ]);
    const canvasValue = {
      pointer: { spaces: { diagram: { x: 0, y: 0 } } },
      coords: { toScreenSpace: (pt) => pt },
    };
    const html = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            awareness,
            sendAwareness: vi.fn(),
            preview: { id: "s1", createdAt: "2026-10-23T12:40:00.000Z" },
          },
        },
        createElement(
          TransformContext.Provider,
          { value: { transform: { zoom: 1, pan: { x: 0, y: 0 } } } },
          createElement(
            CanvasContext.Provider,
            { value: canvasValue },
            createElement(RemoteCursors),
          ),
        ),
      ),
    );
    expect(html).toBe("");
  });

  it("PreviewBanner formats dates, respects role permissions, and confirms restore", async () => {
    const now = new Date("2026-10-23T15:00:00.000Z");
    const sameDayIso = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      12,
      40,
    ).toISOString();
    const otherDayIso = new Date(now.getFullYear(), 9, 20, 9, 5).toISOString();

    expect(formatHistoryTime(sameDayIso, now)).toBe("12:40");
    expect(formatHistoryTime(otherDayIso, now)).toBe("20/10 09:05");

    expect(
      normalizePreviewDoc(
        { tables: [{ id: "t1" }] },
        { database: "postgresql", sqlHeader: "-- hdr" },
      ),
    ).toEqual({
      tables: [{ id: "t1" }],
      relationships: [],
      notes: [],
      areas: [],
      views: [],
      enums: [],
      types: [],
      database: "postgresql",
      sqlHeader: "-- hdr",
    });

    const emptyHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        { value: { preview: null, role: "editor" } },
        createElement(PreviewBanner),
      ),
    );
    expect(emptyHtml).toBe("");

    const viewerHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "viewer",
            preview: { id: "s1", createdAt: sameDayIso },
            endPreview: vi.fn(),
          },
        },
        createElement(PreviewBanner),
      ),
    );
    expect(viewerHtml).toContain("history_preview_banner:");
    expect(viewerHtml).toContain("history_back_to_current");
    expect(viewerHtml).not.toContain("history_restore");

    const editorHtml = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "editor",
            preview: { id: "s1", createdAt: sameDayIso },
            endPreview: vi.fn(),
          },
        },
        createElement(PreviewBanner),
      ),
    );
    expect(editorHtml).toContain("history_restore");
  });
});

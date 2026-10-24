import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  globalThis.DOMRect ??= class DOMRect {};
});

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, onClick, "aria-label": ariaLabel }) =>
    createElement("button", { onClick, "aria-label": ariaLabel }, children),
  Dropdown: Object.assign(
    ({ children, render }) =>
      createElement("div", { "data-dropdown": "true" }, children, render),
    {
      Menu: ({ children }) => createElement("div", null, children),
      Item: ({ children, onClick }) =>
        createElement("button", { onClick }, children),
    },
  ),
  Input: () => null,
  Modal: Object.assign(
    ({ visible, title, children }) =>
      visible ? createElement("div", { "data-modal": title }, children) : null,
    { confirm: vi.fn() },
  ),
  Spin: () => createElement("span", null, "loading"),
  Tag: ({ children }) => createElement("span", null, children),
  Toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
  }),
}));

import { ProjectCollabContext } from "./ProjectCollabProvider";
import HistoryPanel from "./HistoryPanel";

const sampleItems = [
  {
    id: "snap-named",
    kind: "named",
    name: "Antes de v2",
    createdAt: "2026-10-23T13:05:00.000Z",
    createdBy: { id: "u1", name: "Carlos" },
    authors: [],
  },
  {
    id: "snap-bulk",
    kind: "pre_bulk_delete",
    name: null,
    createdAt: "2026-10-23T12:40:00.000Z",
    createdBy: null,
    authors: [{ id: "u2", name: "Pedro" }],
  },
  {
    id: "snap-restore",
    kind: "pre_restore",
    name: null,
    createdAt: "2026-10-23T12:10:00.000Z",
    createdBy: { id: "u3", name: "Ana" },
    authors: [
      { id: "u3", name: "Ana" },
      { id: "u4", name: "Luis" },
    ],
  },
];

describe("HistoryPanel", () => {
  it("oculta guardar versión y el menú de versiones con nombre para viewer, pero muestra las etiquetas por kind", () => {
    const html = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "viewer",
            peers: [{ userId: "u1", name: "Ana" }],
            preview: null,
            previewSnapshot: vi.fn(),
            endPreview: vi.fn(),
            lastRestoredAt: 0,
          },
        },
        createElement(HistoryPanel, { initialItems: sampleItems }),
      ),
    );

    expect(html).not.toContain("history_save_version");
    expect(html).not.toContain("history_rename");
    expect(html).toContain("history_current");
    expect(html).toContain("★ Antes de v2");
    expect(html).toContain("history_kind_pre_bulk_delete");
    expect(html).toContain("history_kind_pre_restore");
    expect(html).toContain("Carlos");
    expect(html).toContain("Pedro");
    expect(html).toContain("Ana, Luis");
  });

  it("muestra guardar versión y el menú de versiones con nombre para editor/admin", () => {
    const html = renderToStaticMarkup(
      createElement(
        ProjectCollabContext.Provider,
        {
          value: {
            projectId: "p1",
            role: "editor",
            peers: [
              { userId: "u1", name: "Ana" },
              { userId: "u2", name: "Luis" },
            ],
            preview: { id: "snap-bulk", createdAt: "2026-10-23T12:40:00.000Z" },
            previewSnapshot: vi.fn(),
            endPreview: vi.fn(),
            lastRestoredAt: 0,
          },
        },
        createElement(HistoryPanel, { initialItems: sampleItems }),
      ),
    );

    expect(html).toContain("history_save_version");
    expect(html).toContain("history_rename");
    expect(html).toContain("★ Antes de v2");
    expect(html).toContain("history_kind_pre_bulk_delete");
    expect(html).toContain("history_kind_pre_restore");
  });
});

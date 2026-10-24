import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  globalThis.DOMRect ??= class DOMRect {};
});

vi.mock("@douyinfe/semi-icons", () => ({
  IconKeyStroked: () => createElement("span", { "data-icon": "key" }),
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, onClick, "aria-label": ariaLabel, "aria-pressed": ariaPressed }) =>
    createElement(
      "button",
      { onClick, "aria-label": ariaLabel, "aria-pressed": ariaPressed },
      children,
    ),
  ButtonGroup: ({ children }) => createElement("div", null, children),
  Modal: ({ visible, title, children }) =>
    visible
      ? createElement(
          "div",
          { "data-modal": title },
          createElement("h2", null, title),
          children,
        )
      : null,
  Tag: ({ children }) => createElement("span", null, children),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) => {
      if (opts && typeof opts === "object") {
        if ("name" in opts) return `${key}:${opts.name}`;
        if ("count" in opts) return `${key}:${opts.count}`;
      }
      return key;
    },
  }),
}));

import { DiagramContext } from "../../context/DiagramContext";
import RelatedDiagram from "./RelatedDiagram";
import RelatedTablesModal from "./RelatedTablesModal";

const sampleTables = [
  {
    id: "t1",
    name: "pedidos",
    x: 0,
    y: 0,
    color: "#3b82f6",
    fields: [
      { id: "f1", name: "id", type: "INT", primary: true, notNull: true },
      { id: "f2", name: "cliente_id", type: "INT", notNull: true },
    ],
  },
  {
    id: "t2",
    name: "clientes",
    x: 300,
    y: 0,
    color: "#10b981",
    hidden: true,
    fields: [
      { id: "f3", name: "id", type: "INT", primary: true, notNull: true },
    ],
  },
  {
    id: "t3",
    name: "aislada",
    x: 600,
    y: 0,
    color: "#f59e0b",
    fields: [{ id: "f4", name: "id", type: "INT", primary: true }],
  },
];

const sampleRelationships = [
  {
    id: "r1",
    startTableId: "t1",
    endTableId: "t2",
    startFieldId: "f2",
    endFieldId: "f3",
  },
];

describe("RelatedTablesModal & RelatedDiagram", () => {
  it("renders nothing when rootId is null", () => {
    const html = renderToStaticMarkup(
      createElement(
        DiagramContext.Provider,
        { value: { tables: sampleTables, relationships: sampleRelationships } },
        createElement(RelatedTablesModal, {
          rootId: null,
          onClose: vi.fn(),
          onFocus: vi.fn(),
        }),
      ),
    );
    expect(html).toBe("");
  });

  it("renders related tables, depth options, hidden badge, and root highlight", () => {
    const html = renderToStaticMarkup(
      createElement(
        DiagramContext.Provider,
        { value: { tables: sampleTables, relationships: sampleRelationships } },
        createElement(RelatedTablesModal, {
          rootId: "t1",
          onClose: vi.fn(),
          onFocus: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("related_title:pedidos");
    expect(html).toContain("related_depth_hops:1");
    expect(html).toContain("related_depth_hops:2");
    expect(html).toContain("related_depth_hops:3");
    expect(html).toContain("related_depth_all");
    expect(html).toContain("related_table_count:2");
    expect(html).toContain("related_focus_to_edit");
    expect(html).toContain("pedidos");
    expect(html).toContain("clientes");
    expect(html).not.toContain("aislada");
    expect(html).toContain("related_hidden_badge");
    expect(html).not.toContain("related_no_relationships");
    expect(html).toContain('data-root="true"');
    expect(html).toContain('data-hidden="true"');
  });

  it("shows related_no_relationships when the table has no relationships", () => {
    const html = renderToStaticMarkup(
      createElement(
        DiagramContext.Provider,
        { value: { tables: sampleTables, relationships: sampleRelationships } },
        createElement(RelatedTablesModal, {
          rootId: "t3",
          onClose: vi.fn(),
          onFocus: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("related_title:aislada");
    expect(html).toContain("related_table_count:1");
    expect(html).toContain("related_no_relationships");
  });

  it("renders RelatedDiagram directly with SVG paths and table fields", () => {
    const html = renderToStaticMarkup(
      createElement(RelatedDiagram, {
        tables: sampleTables.slice(0, 2),
        relationships: sampleRelationships,
        rootId: "t1",
        showComments: false,
      }),
    );

    expect(html).toContain("<svg");
    expect(html).toContain("relationship-path");
    expect(html).toContain("cliente_id");
  });
});

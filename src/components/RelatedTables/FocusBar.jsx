import { useEffect } from "react";
import { Button, ButtonGroup, Tag } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { useDiagram, useFocus } from "../../hooks";
import { FOCUS_DEPTHS } from "../../utils/relatedTables";

function isEditableElement(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if (el.isContentEditable) return true;
  const ce = el.getAttribute?.("contenteditable");
  return ce === "true" || ce === "";
}

export function FocusBar() {
  const { t } = useTranslation();
  const { focus, focusedIds, setFocusDepth, exitFocus } = useFocus() ?? {};
  const { tables = [] } = useDiagram() ?? {};

  useEffect(() => {
    if (!focus) return;
    // Capture phase: Semi UI popovers and tooltips stop Escape from bubbling.
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      const active =
        typeof document !== "undefined" ? document.activeElement : null;
      if (isEditableElement(active)) return;
      exitFocus?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [focus, exitFocus]);

  if (!focus || !focusedIds) return null;

  const rootTable = tables.find((tbl) => tbl.id === focus.rootId);
  const name = rootTable?.name ?? "";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center">
      <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-full border border-blue-300 bg-blue-50 px-5 py-1.5 shadow-md dark:border-sky-900/50 dark:bg-sky-900/30">
        <span className="text-sm font-medium">
          {t("focus_bar_label", { name })}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs opacity-80">{t("related_scope")}:</span>
          <ButtonGroup size="small">
            {FOCUS_DEPTHS.map((d) => {
              const label = Number.isFinite(d)
                ? t("related_depth_hops", { count: d })
                : t("related_depth_all");
              const active = focus.depth === d;
              return (
                <Button
                  key={String(d)}
                  size="small"
                  theme={active ? "solid" : "light"}
                  type={active ? "primary" : "tertiary"}
                  aria-pressed={active}
                  onClick={() => setFocusDepth?.(d)}
                >
                  {label}
                </Button>
              );
            })}
          </ButtonGroup>
        </div>
        <Tag size="small" color="grey">
          {t("related_table_count", { count: focusedIds.size })}
        </Tag>
        <Button
          size="small"
          theme="borderless"
          type="tertiary"
          onClick={() => exitFocus?.()}
        >
          {t("focus_exit")}
        </Button>
      </div>
    </div>
  );
}

export default FocusBar;

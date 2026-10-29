/**
 * The details panel, read-only, for a done or deleted task in the Archive or the Trash (011 FR-022b, US4-8): the
 * same shell (resize, close button, Esc, outside click), the title and details rendered, the dates and the stale
 * history. No editor, no saver, no alert override, no Reschedule.
 */
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { PANEL_MAX_PX, PANEL_MIN_PX, clampPanelWidth } from "../../../domain/panel-width";
import type { Task } from "../../../domain/task";
import { Close } from "../../components/icons";
import { t } from "../../i18n/t";
import { isClose } from "../../keyboard/registry";
import { clearSelection } from "../../keyboard/selection";
import { Markdown } from "../../markdown/Markdown";
import { plain } from "../../markdown/plain";
import { actions, useVesta } from "../../store/store";
import { PanelStatus } from "./PanelStatus";
import { useClickRules } from "./useClickRules";
import { useSelectedRow } from "./selected-row";

export function ReadOnlyBody({ task, onClosed }: { task: Task; onClosed: (id: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const width = useVesta((s) => s.panelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const parent = useVesta((s) => (task.parentId === null ? undefined : s.tasks[task.parentId]));
  useSelectedRow(task.id);

  const close = useCallback(() => {
    actions.closePanel();
    onClosed(task.id);
  }, [task.id, onClosed]);
  // 018 FR-027 (PRD Q275): a click outside the panel and every entry closes it and clears the selection.
  const closeOutside = useCallback(() => {
    actions.closePanel();
    clearSelection();
  }, []);
  useClickRules(ref, close, closeOutside);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!isClose(e.nativeEvent) || e.nativeEvent.isComposing || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  function onResizeStart(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const right = ref.current?.getBoundingClientRect().right ?? window.innerWidth;
    let last = width;
    const move = (ev: globalThis.PointerEvent) => {
      last = clampPanelWidth(right - ev.clientX, window.innerWidth);
      setDragWidth(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setDragWidth(null);
      void actions.setPanelWidth(last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  function onResizeKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowLeft" ? 20 : e.key === "ArrowRight" ? -20 : 0;
    if (step === 0) return;
    e.preventDefault();
    void actions.setPanelWidth(clampPanelWidth(width + step, window.innerWidth));
  }

  const shownWidth = dragWidth ?? clampPanelWidth(width, window.innerWidth);
  return (
    <aside
      ref={ref}
      className="panel"
      aria-label={t("detailsPanel")}
      data-testid="details-panel"
      data-readonly=""
      style={{ "--panel-w": `${String(shownWidth)}px` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <div
        className="panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resizePanel")}
        aria-valuemin={PANEL_MIN_PX}
        aria-valuemax={PANEL_MAX_PX}
        aria-valuenow={shownWidth}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKey}
      />
      <div className="panel-head">
        <h3 className="panel-kind">{parent === undefined ? t("task") : t("subtaskOf", { p: plain(parent.titleMd) })}</h3>
        <span className="saved" />
        <button type="button" className="iconbtn" aria-label={t("close")} title={t("close")} onClick={close}>
          <Close />
        </button>
      </div>
      <div className="panel-body">
        <div>
          <div className="field-label">{t("title")}</div>
          <Markdown md={task.titleMd} scope="title" className="md-host md-title ro-title" />
        </div>
        <div>
          <div className="field-label">{t("detailsLbl")}</div>
          <Markdown md={task.detailsMd} scope="details" className="md-host md-block ro-details" />
        </div>
        <PanelStatus task={task} readOnly />
      </div>
    </aside>
  );
}

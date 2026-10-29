/**
 * The details panel (005 US1, FR-001 to FR-012, research §8): the item's kind, its title and details in live
 * editors, the alert override, the created date, the status and the stale history. No header; the close button
 * is top right with the save state left of it. Edits save 500 ms after typing stops.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { Task } from "../../../domain/task";
import { fitsView } from "../../store/panel-view";
import { ReadOnlyBody } from "./ReadOnlyBody";
import { PANEL_MAX_PX, PANEL_MIN_PX, clampPanelWidth } from "../../../domain/panel-width";
import type { EditorOptions } from "../../editor/create-editor";
import { mountFallback, type EditorLike } from "../../editor/fallback";
import { loadEditor } from "../../editor/load";
import { Check, Close } from "../../components/icons";
import { t } from "../../i18n/t";
import { plain } from "../../markdown/plain";
import { linkHintFor, openLink } from "../../markdown/Markdown";
import { registerFlusher } from "../../store/flush";
import { reportError } from "../../report";
import { actions, useVesta } from "../../store/store";
import { AlertOverrideFields } from "../tasks/AlertOverrideFields";
import { PanelSaver } from "./panel-saver";
import { PanelStatus } from "./PanelStatus";
import { useClickRules } from "./useClickRules";
import { useSelectedRow } from "./selected-row";
import { fileOptions } from "../../editor/files";
import { isClose } from "../../keyboard/registry";
import { clearSelection } from "../../keyboard/selection";
import { storeColorsPort } from "../../editor/colors-port";

export function DetailsPanel() {
  const id = useVesta((s) => s.panelFor);
  const view = useVesta((s) => s.view);
  const task = useVesta((s) => (s.panelFor === null ? undefined : s.tasks[s.panelFor]));
  if (id === null || task === undefined || !fitsView(task, view)) return null;
  // 011 FR-022b: done and deleted tasks open read-only in the Archive and the Trash.
  if (view !== "tasks") return <ReadOnlyBody key={id} task={task} onClosed={focusCard} />;
  return <PanelBody key={id} task={task} />;
}

/** Focus goes back to the card that was shown: its checkbox, or the Archive or Trash row itself. */
function focusCard(id: string): void {
  requestAnimationFrame(() => {
    const li = document.querySelector<HTMLElement>(`li[data-id="${id}"]`);
    (li?.querySelector<HTMLElement>("input.cb") ?? (li?.classList.contains("arow") === true ? li : null))?.focus();
  });
}

function PanelBody({ task }: { task: Task }) {
  const ref = useRef<HTMLElement>(null);
  const titleHost = useRef<HTMLDivElement>(null);
  const detailsHost = useRef<HTMLDivElement>(null);
  const editors = useRef<{ title: EditorLike | null; details: EditorLike | null }>({ title: null, details: null });
  const width = useVesta((s) => s.panelWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const save = useVesta((s) => s.panelSave);
  const parent = useVesta((s) => (task.parentId === null ? undefined : s.tasks[task.parentId]));
  useSelectedRow(task.id);

  const close = useCallback(() => {
    actions.closePanel();
    focusCard(task.id);
  }, [task.id]);
  // 018 FR-027 (PRD Q275): a click outside the panel and every card closes it and clears the selection.
  const closeOutside = useCallback(() => {
    actions.closePanel();
    clearSelection();
  }, []);
  useClickRules(ref, close, closeOutside);

  useEffect(() => {
    const life = { cancelled: false };
    // Read through a call: the flag changes while the editors load.
    const cancelled = () => life.cancelled;
    const saver = new PanelSaver(
      task.id,
      () => ({
        title: editors.current.title?.getMarkdown() ?? null,
        details: editors.current.details?.getMarkdown() ?? null,
      }),
      (view) => {
        actions.setPanelSave(view);
      },
    );
    const unflush = registerFlusher(() => saver.flush());
    void (async () => {
      const initial = useVesta.getState().tasks[task.id];
      if (initial === undefined || titleHost.current === null || detailsHost.current === null) return;
      const titleOptions: EditorOptions = {
        scope: "title",
        colors: storeColorsPort,
        value: initial.titleMd,
        label: t("title"),
        placeholder: t("untitled"),
        ...fileOptions("title"),
        resolveAsset: (refPath) => `vesta-asset://${refPath}`,
        openLink,
        linkTitleFor: linkHintFor,
        onChange: () => {
          saver.edit("title");
        },
        // FR-011: an emptied title shows the last saved one again when the field is left.
        onBlur: () => {
          const editor = editors.current.title;
          const saved = useVesta.getState().tasks[task.id]?.titleMd;
          if (editor !== null && saved !== undefined && plain(editor.getMarkdown()).trim() === "")
            editor.setMarkdown(saved);
        },
        onKey: (key) => {
          if (key === "enter") editors.current.details?.focus();
          else close();
          return true;
        },
      };
      const detailsOptions: EditorOptions = {
        scope: "details",
        colors: storeColorsPort,
        tableRowsFirst: () => useVesta.getState().tableRowsFirst,
        value: initial.detailsMd,
        label: t("detailsLbl"),
        placeholder: t("detailsPh"),
        ...fileOptions("details"),
        resolveAsset: (refPath) => `vesta-asset://${refPath}`,
        openLink,
        linkTitleFor: linkHintFor,
        onChange: () => {
          saver.edit("details");
        },
        onKey: (key) => {
          if (key !== "escape") return false;
          close();
          return true;
        },
      };
      let title: EditorLike;
      let details: EditorLike;
      try {
        const { createEditor } = await loadEditor();
        if (cancelled()) return;
        title = await createEditor(titleHost.current, titleOptions);
        details = await createEditor(detailsHost.current, detailsOptions);
      } catch (err) {
        // FR-038: plain markdown fields; saving still works, and the error is logged.
        reportError("details.editor", err);
        if (cancelled()) return;
        titleHost.current.replaceChildren();
        detailsHost.current.replaceChildren();
        title = mountFallback(titleHost.current, titleOptions);
        details = mountFallback(detailsHost.current, detailsOptions);
      }
      if (cancelled()) {
        title.destroy();
        details.destroy();
        return;
      }
      editors.current = { title, details };
      requestAnimationFrame(() => {
        if (cancelled()) return;
        title.markReady();
        details.markReady();
      });
    })();
    return () => {
      life.cancelled = true;
      unflush();
      // Close or switch: the pending edit is sent first, with the editors' text read now (FR-009).
      void saver.close();
      editors.current.title?.destroy();
      editors.current.details?.destroy();
      editors.current = { title: null, details: null };
    };
  }, [task.id, close]);

  // 007 FR-017: a language switch re-labels the open editors in place; their text and history stay.
  const language = useVesta((st) => st.language);
  useEffect(() => {
    editors.current.title?.relabel(t("title"), t("untitled"));
    editors.current.details?.relabel(t("detailsLbl"), t("detailsPh"));
  }, [language]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (!isClose(e.nativeEvent) || e.nativeEvent.isComposing || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    close();
  }

  // FR-005: the left edge resizes; the width is saved when the drag ends.
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
  const status = save.failedSticky ? "fail" : save.state === "saved" ? "ok" : "";
  return (
    <aside
      ref={ref}
      className="panel"
      aria-label={t("detailsPanel")}
      data-testid="details-panel"
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
        <span className={`saved ${status}`} role="status" aria-live="polite">
          {save.state === "saved" && <Check />}
          {save.failedSticky ? t("panelSaveFail") : save.state === "saved" ? t("saved") : ""}
        </span>
        <button type="button" className="iconbtn" aria-label={t("close")} title={t("close")} onClick={close}>
          <Close />
        </button>
      </div>
      <div className="panel-body">
        <div>
          <div className="field-label">{t("title")}</div>
          <div ref={titleHost} className="md-host md-title ed-title" />
        </div>
        <div>
          <div className="field-label">{t("detailsLbl")}</div>
          <div ref={detailsHost} className="md-host md-block md-editor" />
        </div>
        <fieldset className="ov-set">
          <legend>{t("ovLegend")}</legend>
          <AlertOverrideFields task={task} legend={t("ovLegend")} legendClassName="sr-only" />
        </fieldset>
        <PanelStatus task={task} />
      </div>
    </aside>
  );
}

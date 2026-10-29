// Mounts a live editor in a host element. The editor loads asynchronously, so until it is ready the host
// takes the focus and queues what is typed (text, Enter, Esc, in order); the queue is replayed once it is
// ready, so nothing typed right after opening a card is lost, even "Alpha" Enter "Beta" Enter.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useVesta } from "../store/store";
import { reportError } from "../report";
import type { EditorOptions } from "./create-editor";
import { mountFallback, type EditorLike } from "./fallback";
import { loadEditor } from "./load";

/** Longer than ProseMirror's 20 ms post-focus selection restore. */
const FOCUS_SETTLE_MS = 40;

export function useLiveEditor(
  host: RefObject<HTMLDivElement | null>,
  options: () => EditorOptions,
  context: string,
): RefObject<EditorLike | null> {
  const editor = useRef<EditorLike | null>(null);
  // 007 FR-017: after a language switch, the open editor takes the new label and placeholder in place.
  const latest = useRef(options);
  latest.current = options;
  const language = useVesta((s) => s.language);
  useEffect(() => {
    const o = latest.current();
    editor.current?.relabel(o.label, o.placeholder);
  }, [language]);
  useLayoutEffect(() => {
    const el = host.current;
    if (el === null) return;
    const life = { alive: true };
    const alive = () => life.alive;
    type Queued = { text: string } | { key: "enter" | "escape" };
    const queue: Queued[] = [];
    const early = (e: KeyboardEvent) => {
      if (editor.current !== null || e.isComposing) return;
      const last = queue[queue.length - 1];
      if (last !== undefined && "key" in last && last.key === "escape") return;
      if (e.key === "Enter" || e.key === "Escape") {
        queue.push({ key: e.key === "Enter" ? "enter" : "escape" });
        e.preventDefault();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (last !== undefined && "text" in last) last.text += e.key;
        else queue.push({ text: e.key });
        e.preventDefault();
      }
    };
    el.tabIndex = -1;
    el.addEventListener("keydown", early);
    el.focus();
    const opts = options();
    void (async () => {
      try {
        let handle: EditorLike;
        try {
          const { createEditor } = await loadEditor();
          if (!alive()) return;
          handle = await createEditor(el, opts);
        } catch (err) {
          // FR-038: a plain markdown field, with the error in the log.
          reportError(context, err);
          if (!alive()) return;
          handle = mountFallback(el, opts);
        }
        if (!alive()) {
          handle.destroy();
          return;
        }
        editor.current = handle;
        el.removeEventListener("keydown", early);
        el.removeAttribute("tabindex");
        // The caret goes to the end only from the host's focus; focus and a selection already inside the
        // editor are kept (focus() itself keeps a selection made inside the view).
        const active = document.activeElement;
        if (active === el || active === null || active === document.body || !el.contains(active)) handle.focus(true);
        // ProseMirror puts its own selection back 20 ms after the editor gains the focus; the editor is offered
        // as a text field (its textbox role) only once that has passed, so typing never lands in that window.
        setTimeout(() => {
          if (alive()) handle.markReady();
        }, FOCUS_SETTLE_MS);
        for (const item of queue.splice(0)) {
          if ("text" in item) handle.insertText(item.text);
          else opts.onKey?.(item.key);
        }
      } catch (err) {
        reportError(context, err);
      }
    })();
    return () => {
      life.alive = false;
      el.removeEventListener("keydown", early);
      editor.current?.destroy();
      editor.current = null;
    };
    // Mounted once per edit; the options are read when the edit starts.
  }, []);
  return editor;
}

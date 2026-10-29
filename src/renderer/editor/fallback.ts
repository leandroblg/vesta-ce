// FR-038: when the live editor cannot start, a plain markdown field takes its place, with the same contract
// (onChange, onBlur, onKey), so saving still works; the message points to the log.
import { t } from "../i18n/t";
import { isClose } from "../keyboard/registry";
import type { EditorOptions } from "./create-editor";

/** What owners use of an editor; the live editor and the fallback both provide it. */
export interface EditorLike {
  getMarkdown(): string;
  setMarkdown(md: string): void;
  focus(atEnd?: boolean): void;
  insertText(text: string): void;
  /** New label and placeholder after a language switch, keeping the text and history (007 FR-017). */
  relabel(label: string | undefined, placeholder: string | undefined): void;
  /** The editor is live (the plain field always is). */
  markReady(): void;
  destroy(): void;
}

export function mountFallback(host: HTMLElement, options: EditorOptions): EditorLike {
  const inline = options.scope !== "details";
  const field = document.createElement("textarea");
  field.className = inline ? "md-fallback md-fallback-inline" : "md-fallback";
  field.value = options.value;
  field.rows = inline ? 1 : 8;
  if (options.label !== undefined) field.setAttribute("aria-label", options.label);
  if (options.placeholder !== undefined) field.placeholder = options.placeholder;
  const note = document.createElement("p");
  note.className = "md-fallback-note";
  note.textContent = t("edFallback");
  host.append(field, note);
  const onInput = () => options.onChange?.();
  const onBlur = () => options.onBlur?.();
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (isClose(e) && options.onKey?.("escape") === true) e.preventDefault();
    else if (inline && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      options.onKey?.("enter");
    }
  };
  field.addEventListener("input", onInput);
  field.addEventListener("blur", onBlur);
  field.addEventListener("keydown", onKey);
  return {
    // A title is one line (001 FR-019); details are kept as typed.
    getMarkdown: () => (inline ? field.value.replace(/\s*[\r\n]+\s*/g, " ") : field.value),
    setMarkdown: (md) => {
      field.value = md;
    },
    focus: (atEnd = false) => {
      field.focus();
      if (atEnd) field.setSelectionRange(field.value.length, field.value.length);
    },
    insertText: (text) => {
      field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
    },
    markReady: () => undefined,
    relabel: (label, placeholder) => {
      if (label === undefined) field.removeAttribute("aria-label");
      else field.setAttribute("aria-label", label);
      field.placeholder = placeholder ?? "";
      note.textContent = t("edFallback");
    },
    destroy: () => {
      field.removeEventListener("input", onInput);
      field.removeEventListener("blur", onBlur);
      field.removeEventListener("keydown", onKey);
      field.remove();
      note.remove();
    },
  };
}

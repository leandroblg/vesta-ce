/**
 * Inline editing of a task title or a reminder's text (001 FR-017 to FR-019, 002 FR-010), in the live title
 * editor (005 FR-013, FR-022): Enter or a click outside saves, Esc discards, no autosave; empty text shows the
 * last saved one again. Closing or quitting counts as a click outside. Enter during IME composition belongs to
 * the composition.
 */
import { useEffect, useRef } from "react";
import { normalizeTitle } from "../../../domain/title";
import { useLiveEditor } from "../../editor/useLiveEditor";
import { t, enterKey } from "../../i18n/t";
import { linkHintFor, openLink } from "../../markdown/Markdown";
import { registerFlusher } from "../../store/flush";
import { actions } from "../../store/store";
import { fileOptions } from "../../editor/files";
import { storeColorsPort } from "../../editor/colors-port";

interface Props {
  /** The last saved text. */
  value: string;
  /** Accessible name of the editor. */
  label: string;
  /** Saves normalized, changed text. */
  onSave: (text: string) => Promise<unknown>;
  scope?: "title" | "reminder";
}

/** 016 FR-016c: the unsafe link a click on the shown text asked to open on, read once. */
function unsafeLinkOption(): { unsafeLinkAt?: number } {
  const index = actions.takeUnsafeLink();
  return index === null || index < 0 ? {} : { unsafeLinkAt: index };
}

export function InlineTitleEditor({ value, label, onSave, scope = "title" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  // The editor's callbacks call the latest commit and cancel.
  const commitRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const cancelRef = useRef<() => void>(() => undefined);
  const editor = useLiveEditor(
    host,
    () => ({
      scope,
      value,
      label,
      ...fileOptions(scope),
      colors: storeColorsPort,
      resolveAsset: (ref) => `vesta-asset://${ref}`,
      openLink,
      linkTitleFor: linkHintFor,
      ...unsafeLinkOption(),
      onKey: (key) => {
        if (key === "enter") void commitRef.current();
        else cancelRef.current();
        return true;
      },
      onBlur: () => {
        void commitRef.current();
      },
    }),
    "inline.editor",
  );

  async function commit() {
    if (done.current) return;
    done.current = true;
    const title = normalizeTitle(editor.current?.getMarkdown() ?? value);
    actions.stopEditingAfterRelease();
    if (title !== null && title !== value) await onSave(title);
  }

  function cancel() {
    done.current = true;
    actions.stopEditing();
  }

  useEffect(() => {
    commitRef.current = commit;
    cancelRef.current = cancel;
  });

  useEffect(() => registerFlusher(() => commitRef.current()), []);

  return (
    <>
      <div ref={host} className="inline-edit md-host md-title" />
      <div className="edit-hint">{t("editHint", { enter: enterKey() })}</div>
    </>
  );
}

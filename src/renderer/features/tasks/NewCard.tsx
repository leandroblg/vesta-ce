/**
 * An empty card that adds an item: the end of the task list, the temporary card under a parent for a
 * new subtask (001 FR-011 to FR-014), or the end of the reminders (002 FR-006, FR-007). Enter with text
 * adds and stays ready; empty text creates nothing; Esc discards; a click outside with text adds.
 * The text is typed in the live title editor, so formatting converts as it is typed (005 FR-013).
 */
import { useEffect, useRef } from "react";
import { normalizeTitle } from "../../../domain/title";
import { useLiveEditor } from "../../editor/useLiveEditor";
import { Plus } from "../../components/icons";
import { t, enterKey } from "../../i18n/t";
import { linkHintFor, openLink } from "../../markdown/Markdown";
import { registerFlusher } from "../../store/flush";
import { actions, useVesta, type EditingKey } from "../../store/store";
import { fileOptions } from "../../editor/files";
import { storeColorsPort } from "../../editor/colors-port";

interface Props {
  editingKey: EditingKey;
  /** `sub`: the temporary card under a parent, shown only while editing. */
  kind: "task" | "sub" | "rem";
  placeholder: string;
  onCreate: (text: string) => Promise<unknown>;
}

/** The footer row of an inset group (HIG identity, B · Hearth): a plus in a ring and the placeholder. */
export function NewCard({ editingKey: key, kind, placeholder, onCreate }: Props) {
  const editing = useVesta((s) => s.editingKey === key);
  if (kind === "sub" && !editing) return null;
  const classes = ["row", "newcard", kind === "sub" ? "sub" : "", editing ? "editing" : ""].filter(Boolean).join(" ");

  return (
    <li className={classes} data-kind={`new-${kind}`}>
      <span className="newplus" aria-hidden="true">
        <Plus />
      </span>
      <div className="title-wrap">
        {editing ? (
          <NewCardEditor kind={kind} placeholder={placeholder} onCreate={onCreate} />
        ) : (
          <button
            type="button"
            className="newbtn"
            onClick={() => {
              actions.startEditing(key);
            }}
          >
            {placeholder}
          </button>
        )}
      </div>
    </li>
  );
}

function NewCardEditor({ kind, placeholder, onCreate }: Pick<Props, "kind" | "placeholder" | "onCreate">) {
  const host = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const submitRef = useRef<(keepOpen: boolean) => Promise<void>>(() => Promise.resolve());
  const closeRef = useRef<() => void>(() => undefined);
  const editor = useLiveEditor(
    host,
    () => ({
      scope: kind === "rem" ? "reminder" : "title",
      value: "",
      label: placeholder,
      placeholder,
      ...fileOptions(kind === "rem" ? "reminder" : "title"),
      colors: storeColorsPort,
      resolveAsset: (ref) => `vesta-asset://${ref}`,
      openLink,
      linkTitleFor: linkHintFor,
      onKey: (key) => {
        if (key === "enter") void submitRef.current(true);
        else closeRef.current();
        return true;
      },
      onBlur: () => {
        if (closing.current) {
          closing.current = false;
          return;
        }
        void submitRef.current(false);
      },
    }),
    "newcard.editor",
  );

  function close() {
    closing.current = true;
    actions.stopEditingAfterRelease();
  }

  async function submit(keepOpen: boolean) {
    const title = normalizeTitle(editor.current?.getMarkdown() ?? "");
    editor.current?.setMarkdown("");
    if (title === null) {
      close();
      return;
    }
    if (!keepOpen) close();
    await onCreate(title);
    if (keepOpen) editor.current?.focus(true);
  }

  useEffect(() => {
    submitRef.current = submit;
    closeRef.current = close;
  });

  // Closing the window or quitting counts as a click outside (FR-018).
  useEffect(() => registerFlusher(() => submitRef.current(false)), []);

  return (
    <>
      <div ref={host} className="inline-edit md-host md-title" />
      <div className="edit-hint">{t("editHint", { enter: enterKey() })}</div>
    </>
  );
}

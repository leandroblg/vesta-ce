/**
 * One reminder card (FR-004, FR-005, FR-009, FR-010, FR-012): done checkbox, text as plain text,
 * hover/focus buttons Edit and Delete ("Move to Trash"), and the drag handle (004). No collapse
 * toggle, no menu, no details panel: a single click on the text opens nothing.
 */
import { useCallback, useEffect, useRef } from "react";
import type { Reminder } from "../../../domain/reminder";
import { Close, Edit, Grip } from "../../components/icons";
import { t } from "../../i18n/t";
import { flushAll } from "../../store/flush";
import { actions, useVesta } from "../../store/store";
import { InlineTitleEditor } from "../tasks/InlineTitleEditor";
import { plain } from "../../markdown/plain";
import { Markdown } from "../../markdown/Markdown";
import { inCardArea, pressTracker } from "../tasks/card-area";

interface Props {
  reminder: Reminder;
  /** 006 FR-012: the reminder matches the search, so its text is highlighted. */
  highlight?: boolean;
  /** 006 T056: a row of a virtualized list tells screen readers its position and the total. */
  setPos?: { pos: number; size: number } | null;
}

export function ReminderCard({ reminder, highlight = false, setPos = null }: Props) {
  const editing = useVesta((s) => s.editingKey === reminder.id);
  // 016 FR-016c (Q257): a click on an unsafe link in the text starts editing on it.
  const onUnsafeLink = useCallback((index: number) => {
    actions.editUnsafeLink(reminder.id, index);
  }, [reminder.id]);
  const dragging = useVesta((s) => s.drag?.id === reminder.id);
  const movingDisabled = useVesta((s) => s.movingDisabled);
  const self = useRef<HTMLLIElement>(null);
  const press = useRef(pressTracker()).current;
  const refocus = useVesta((s) => (s.focusAfterMove?.id === reminder.id ? s.focusAfterMove.ctl : null));
  // After a keyboard move, the same control has focus again (004 FR-024).
  useEffect(() => {
    if (refocus === null) return;
    self.current?.querySelector<HTMLElement>(`[data-ctl="${refocus}"]`)?.focus();
    actions.setFocusAfterMove(null);
  }, [refocus]);
  const classes = ["row", "rem", editing ? "editing" : "", dragging ? "dragging" : ""].filter(Boolean).join(" ");

  return (
    <li
      ref={self}
      className={classes}
      data-kind="rem"
      data-id={reminder.id}
      aria-describedby="drag-handle-hint drag-hint"
      aria-posinset={setPos?.pos}
      aria-setsize={setPos?.size}
      onPointerDown={(e) => {
        press.down(e);
      }}
      // 011 FR-022: a double click anywhere in the card area edits; a single click opens nothing (no details).
      onDoubleClick={(e) => {
        if (editing || !inCardArea(e.target, e.clientX, e.currentTarget) || press.moved(e)) return;
        actions.startEditing(reminder.id);
      }}
    >
      <input
        type="checkbox"
        className="cb"
        data-ctl="cb"
        checked={false}
        aria-label={t("markDone", { t: plain(reminder.textMd) })}
        onChange={() => {
          // An open inline edit (task or reminder) is saved first, then the reminder is marked done.
          void flushAll().then(() => actions.markReminderDone(reminder.id));
        }}
      />
      <div className="title-wrap">
        {editing ? (
          <InlineTitleEditor
            value={reminder.textMd}
            label={plain(reminder.textMd)}
            onSave={(text) => actions.editReminderText(reminder.id, text)}
            scope="reminder"
          />
        ) : (
          <div className="title" data-hl={highlight ? "" : undefined}>
            <Markdown md={reminder.textMd} scope="reminder" onUnsafeLink={onUnsafeLink} />
          </div>
        )}
      </div>
      {/* 014 FR-001 (PRD Q197, Q199): the zone for Edit, Delete and the drag handle, the same width on every reminder. */}
      <div className="zone">
        <div className="zone-stack">
          {!editing && (
            <div className="actions">
              <button
                type="button"
                className="act icon"
                data-ctl="edit"
                aria-label={t("edit")}
                title={t("edit")}
                onClick={() => {
                  actions.startEditing(reminder.id);
                }}
              >
                <Edit />
              </button>
              <button
                type="button"
                className="act icon"
                data-ctl="del"
                aria-label={t("toTrash")}
                title={t("toTrash")}
                onClick={() => void actions.deleteReminder(reminder.id)}
              >
                <Close />
              </button>
            </div>
          )}
        </div>
        <span className={movingDisabled ? "grip off" : "grip"} title={t("drag")} aria-hidden="true">
          <Grip />
        </span>
      </div>
    </li>
  );
}

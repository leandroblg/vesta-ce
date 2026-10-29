/**
 * Keyboard moves (004 FR-024 to FR-028): Alt+Up/Down/Left/Right on the card that has focus, unless text
 * is being edited or moving is disabled. The destination comes from the domain (keyboardDest), the move
 * goes through the same channel as a drop, focus returns to the same control, and a polite announcement
 * gives the new position (FR-027), after drops too.
 */
import { isPinned } from "../../../../domain/alerts";
import { keyboardDest, positionInList, type KeyMove } from "../../../../domain/move";
import { keyboardReminderDest } from "../../../../domain/reminder-actions";
import { activeReminders } from "../../../../domain/reminder-views";
import { t } from "../../../i18n/t";
import { actions, useVesta } from "../../../store/store";
import { plain } from "../../../markdown/plain";
import { inEditor } from "../../../keyboard/editing";

/** Where a task was before a move, to word the announcement. */
export interface Before {
  parentId: string | null;
  pinned: boolean;
}

export function beforeOf(id: string): Before | null {
  const task = useVesta.getState().tasks[id];
  return task === undefined ? null : { parentId: task.parentId, pinned: isPinned(task) };
}

/** The FR-027 text for a task after its move has been merged into the store. */
export function taskAnnouncement(id: string, before: Before): string | null {
  const rows = Object.values(useVesta.getState().tasks);
  const task = useVesta.getState().tasks[id];
  if (task === undefined) return null;
  const { n, m, parentTitle } = positionInList(id, rows);
  const title = plain(task.titleMd);
  const parent = parentTitle === null ? null : plain(parentTitle);
  if (!before.pinned && isPinned(task)) return t("rejoined", { t: title, n, m });
  if (before.parentId === null && parent !== null) return t("nowSubOf", { t: title, p: parent, n, m });
  if (before.parentId !== null && parent === null) return t("nowTop", { t: title, n, m });
  return parent === null ? t("movedTo", { t: title, n, m }) : t("movedToIn", { t: title, p: parent, n, m });
}

export function reminderAnnouncement(id: string): string | null {
  const s = useVesta.getState();
  const list = activeReminders(Object.values(s.reminders));
  const i = list.findIndex((r) => r.id === id);
  const reminder = list[i];
  return reminder === undefined ? null : t("movedTo", { t: plain(reminder.textMd), n: i + 1, m: list.length });
}

/** Announces a move that changed something (called after the reply is merged). */
export function announceMove(id: string, kind: "task" | "rem", before: Before | null): void {
  const text = kind === "rem" ? reminderAnnouncement(id) : before === null ? null : taskAnnouncement(id, before);
  if (text !== null) actions.announce(text);
}

/**
 * Moves the card that has focus (004 FR-024 to FR-028), for the shortcut registry's move, promote and demote
 * actions (007 research §10). False when nothing moved, so the key keeps its native action.
 */
export function keyboardMove(target: EventTarget | null, key: KeyMove): boolean {
  if (inEditor(target) || useVesta.getState().movingDisabled || useVesta.getState().drag !== null) return false;
  if (!(target instanceof HTMLElement)) return false;
  const li = target.closest<HTMLElement>("li[data-id]");
  const id = li?.dataset["id"];
  const kind = li?.dataset["kind"];
  if (li === null || id === undefined || (kind !== "task" && kind !== "rem")) return false;
  const ctl = document.activeElement instanceof HTMLElement ? (document.activeElement.dataset["ctl"] ?? "cb") : "cb";
  const s = useVesta.getState();
  if (kind === "rem") {
    const beforeId = keyboardReminderDest(id, key, Object.values(s.reminders));
    if (beforeId === undefined) return false;
    void actions.moveReminder(id, beforeId).then((m) => {
      if (m === null || (m.reminders?.upserts.length ?? 0) === 0) return;
      actions.setFocusAfterMove({ id, ctl });
      announceMove(id, "rem", null);
    });
    return true;
  }
  const dest = keyboardDest(id, key, Object.values(s.tasks));
  if (dest === null) return false;
  const before = beforeOf(id);
  void actions.moveTask(id, dest).then((m) => {
    if (m === null || m.upserts.length === 0) return;
    actions.setFocusAfterMove({ id, ctl });
    announceMove(id, "task", before);
  });
  return true;
}

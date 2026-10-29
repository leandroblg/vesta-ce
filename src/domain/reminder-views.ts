/** Views over the reminder rows (FR-002, FR-007a). */
import { MAX_ACTIVE_REMINDERS, isActiveReminder, type Reminder } from "./reminder";

/** Equal positions: creation time, then id (008 FR-036). */
const byPosition = (a: Reminder, b: Reminder) =>
  a.position - b.position || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Active reminders in their stored order (FR-002). */
export function activeReminders(rows: readonly Reminder[]): Reminder[] {
  return rows.filter(isActiveReminder).sort(byPosition);
}

/** True while 200 or more reminders are active: the empty card adds nothing (FR-007a, PRD Q92). */
export function atReminderLimit(rows: readonly Reminder[]): boolean {
  return rows.filter(isActiveReminder).length >= MAX_ACTIVE_REMINDERS;
}

const newest = (field: "doneAt" | "deletedAt") => (a: Reminder, b: Reminder) => (b[field] ?? 0) - (a[field] ?? 0);

/** Done reminders, newest first: the Archive's Reminders division (FR-016). */
export function reminderArchive(rows: readonly Reminder[]): Reminder[] {
  return rows.filter((r) => r.doneAt !== null).sort(newest("doneAt"));
}

/** Deleted reminders, newest first: the Trash's Reminders division (FR-016). */
export function reminderTrash(rows: readonly Reminder[]): Reminder[] {
  return rows.filter((r) => r.deletedAt !== null).sort(newest("deletedAt"));
}

/** Reminders in each view, added to the header counts (FR-020). */
export function reminderCounts(rows: readonly Reminder[]): { archive: number; trash: number } {
  return { archive: rows.filter((r) => r.doneAt !== null).length, trash: rows.filter((r) => r.deletedAt !== null).length };
}


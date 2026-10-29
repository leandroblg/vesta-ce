/** Undo of the latest done, delete, restore or reschedule (FR-026, FR-028; research.md §5; 016 FR-002). */
import type { Clock } from "./clock";
import type { UndoKind } from "./notifications";
import { bringBack } from "./placement";
import { emptyReminderChangeSet, isActiveReminder, type Reminder, type ReminderChangeSet } from "./reminder";
import { bringBackReminder } from "./reminder-actions";
import { emptyChangeSet, isActive, type ChangeSet, type Task } from "./task";

/** 018 (research §4): a store kind besides the notification's; an Archive delete is undone like a restore. */
export type UndoRecordKind = UndoKind | "trashDone";

export interface UndoInput {
  kind: UndoRecordKind;
  /** The rows the action changed, as they were before it; the acted-on item first. */
  before: readonly Task[];
  /** 015 FR-019 (PRD Q215): the history events the action recorded; the undo removes them. */
  eventIds?: readonly string[];
}

/** The same record for a reminder action (002 FR-014): one store keeps the latest of either kind. */
export interface ReminderUndoInput {
  subject: "reminder";
  kind: UndoRecordKind;
  before: readonly Reminder[];
}

export function isReminderUndo(record: UndoInput | ReminderUndoInput): record is ReminderUndoInput {
  return "subject" in record;
}

export function beforeOf(rows: readonly Task[], changes: ChangeSet): Task[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ids = [...changes.upserts.map((u) => u.id), ...changes.removals];
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
}

export function applyUndo(record: UndoInput, tasks: readonly Task[], clock: Clock): ChangeSet {
  const now = clock.now();
  if (record.kind === "done" || record.kind === "delete") {
    const main = record.before[0];
    const current = main === undefined ? undefined : tasks.find((t) => t.id === main.id);
    if (current === undefined || isActive(current)) return emptyChangeSet();
    return bringBack(current, tasks, now);
  }
  if (record.kind === "reschedule") return undoReschedule(record.before, tasks, now);
  // Undo of a restore, or of an Archive delete (018): rows that were in the Archive or Trash go back there with their
  // original dates. A parent the restore expanded collapses again, unless the user collapsed it since; collapse is not an
  // edit (003 FR-028a, Q103).
  const upserts = record.before.flatMap((b) => {
    const current = tasks.find((t) => t.id === b.id);
    if (current === undefined) return [];
    if (isActive(b)) return b.collapsed && !current.collapsed ? [{ ...current, collapsed: true }] : [];
    return [
      {
        ...current,
        collapsed: current.collapsed || b.collapsed,
        parentId: b.parentId,
        position: b.position,
        doneAt: b.doneAt,
        deletedAt: b.deletedAt,
        keptDoneAt: b.keptDoneAt,
        prevSiblingId: b.prevSiblingId,
        nextSiblingId: b.nextSiblingId,
        leftWithId: b.leftWithId,
        updatedAt: now,
      },
    ];
  });
  return { upserts, removals: [] };
}

/**
 * 016 FR-002 (research §1): a reschedule changed one row; its reschedule fields go back as they were, and every
 * other field keeps its current value, so an alert period override changed since stays.
 */
function undoReschedule(before: readonly Task[], tasks: readonly Task[], now: number): ChangeSet {
  const upserts = before.flatMap((b) => {
    const current = tasks.find((t) => t.id === b.id);
    if (current === undefined || !isActive(current)) return [];
    return [
      {
        ...current,
        staleSince: b.staleSince,
        firstBlinkCount: b.firstBlinkCount,
        staleBaseAt: b.staleBaseAt,
        rescheduleForMin: b.rescheduleForMin,
        wasStale: b.wasStale,
        position: b.position,
        manuallyPositioned: b.manuallyPositioned,
        updatedAt: now,
      },
    ];
  });
  return { upserts, removals: [] };
}

/**
 * Undo of the latest reminder done, delete or restore (002 FR-015). Never changes the Reminders
 * section's collapsed state (FR-018, PRD Q91), unlike task undo, which expands a collapsed parent.
 */
export function applyReminderUndo(record: ReminderUndoInput, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  const now = clock.now();
  if (record.kind === "done" || record.kind === "delete") {
    const main = record.before[0];
    const current = main === undefined ? undefined : rows.find((r) => r.id === main.id);
    if (current === undefined || isActiveReminder(current)) return emptyReminderChangeSet();
    return { upserts: bringBackReminder(current, rows, now), removals: [], sectionCollapsed: null };
  }
  // Undo of a restore, or of an Archive delete (018): rows that were in the Archive or Trash go back there with their
  // original dates.
  const upserts = record.before.flatMap((b) => {
    if (isActiveReminder(b)) return [];
    const current = rows.find((r) => r.id === b.id);
    if (current === undefined) return [];
    return [
      {
        ...current,
        position: b.position,
        doneAt: b.doneAt,
        deletedAt: b.deletedAt,
        keptDoneAt: b.keptDoneAt,
        prevSiblingId: b.prevSiblingId,
        nextSiblingId: b.nextSiblingId,
        updatedAt: now,
      },
    ];
  });
  return { upserts, removals: [], sectionCollapsed: null };
}


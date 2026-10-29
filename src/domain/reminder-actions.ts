/**
 * Every reminder action as a pure function of the current rows → ReminderChangeSet (research.md §4).
 * Rules shared with tasks call the task code: text normalization (`title.ts`) and the neighbour rule
 * (`list-placement.ts`).
 */
import type { Clock } from "./clock";
import { neighboursOf, placePosition, positionAt } from "./list-placement";
import { endPosition } from "./positions";
import { MAX_ACTIVE_REMINDERS, emptyReminderChangeSet, isActiveReminder, type Reminder, type ReminderChangeSet } from "./reminder";
import { activeReminders } from "./reminder-views";
import { DomainError } from "./task";
import type { KeyMove } from "./move";
import { normalizeTitle } from "./title";

/** Adds a reminder at the end of the active reminders (FR-006). Empty text creates nothing; refused at the limit (FR-007a). */
export function createReminder(input: { text: string }, rows: readonly Reminder[], clock: Clock, newId: () => string): ReminderChangeSet {
  const text = normalizeTitle(input.text);
  if (text === null) return emptyReminderChangeSet();
  const active = activeReminders(rows);
  if (active.length >= MAX_ACTIVE_REMINDERS) throw new DomainError("INVALID", "maximum reminders reached");
  const now = clock.now();
  const reminder: Reminder = {
    id: newId(),
    textMd: text,
    position: endPosition(active.map((r) => r.position)),
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    deletedAt: null,
    keptDoneAt: null,
    prevSiblingId: null,
    nextSiblingId: null,
  };
  return { upserts: [reminder], removals: [], sectionCollapsed: null };
}

export function findReminder(rows: readonly Reminder[], id: string): Reminder {
  const reminder = rows.find((r) => r.id === id);
  if (reminder === undefined) throw new DomainError("NOT_FOUND", `reminder ${id} not found`);
  return reminder;
}

export function findActiveReminder(rows: readonly Reminder[], id: string): Reminder {
  const reminder = findReminder(rows, id);
  if (!isActiveReminder(reminder)) throw new DomainError("INVALID", `reminder ${id} is not active`);
  return reminder;
}

/** Saves new text (FR-010, same rules as task titles). Empty or unchanged text saves nothing. */
export function editReminderText(id: string, raw: string, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  const reminder = findActiveReminder(rows, id);
  const text = normalizeTitle(raw);
  if (text === null || text === reminder.textMd) return emptyReminderChangeSet();
  return { upserts: [{ ...reminder, textMd: text, updatedAt: clock.now() }], removals: [], sectionCollapsed: null };
}

type LeaveField = "doneAt" | "deletedAt";

/** Done or delete: the reminder leaves the active list with the time and its neighbours (FR-011 to FR-013). */
function leave(id: string, field: LeaveField, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  const reminder = findActiveReminder(rows, id);
  const now = clock.now();
  const gone: Reminder = { ...reminder, [field]: now, updatedAt: now, ...neighboursOf(activeReminders(rows), reminder.id) };
  return { upserts: [gone], removals: [], sectionCollapsed: null };
}

/** Move to the Trash's Reminders division (FR-012, FR-013). */
export function removeReminder(id: string, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  return leave(id, "deletedAt", rows, clock);
}

/** Mark done: to the Archive's Reminders division (FR-011, FR-013). */
export function markReminderDone(id: string, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  return leave(id, "doneAt", rows, clock);
}

/** 018 FR-010 (PRD Q272): an Archive reminder goes to the Trash, keeping its completion date in keptDoneAt. */
export function trashDoneReminder(id: string, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  const reminder = findReminder(rows, id);
  if (reminder.doneAt === null || reminder.deletedAt !== null) throw new DomainError("INVALID", `reminder ${id} is not in the Archive`);
  const now = clock.now();
  return { upserts: [{ ...reminder, doneAt: null, deletedAt: now, keptDoneAt: reminder.doneAt, updatedAt: now }], removals: [], sectionCollapsed: null };
}

/**
 * Brings a done or deleted reminder back among the active reminders by the neighbour rule shared with
 * tasks (FR-015, FR-017): after its former previous neighbour, else before its former next one, else at
 * the end. The creation date never changes; renumbering never changes last-edit times.
 */
export function bringBackReminder(item: Reminder, rows: readonly Reminder[], now: number): Reminder[] {
  const siblings = activeReminders(rows).filter((r) => r.id !== item.id);
  const placed = placePosition(item, siblings);
  const back: Reminder = { ...item, position: placed.position, doneAt: null, deletedAt: null, prevSiblingId: null, nextSiblingId: null, updatedAt: now };
  const renumbered = placed.renumbered;
  const moved = renumbered === null ? [] : siblings.map((r) => ({ ...r, position: renumbered.get(r.id) ?? r.position }));
  return [back, ...moved];
}

/**
 * Restore from the Archive or Trash (FR-017), expanding a collapsed Reminders section in the same change
 * set (FR-018, PRD Q91). Never refused by the 200 limit (FR-007a).
 */
export function restoreReminder(id: string, rows: readonly Reminder[], sectionCollapsed: boolean, clock: Clock): ReminderChangeSet {
  const reminder = findReminder(rows, id);
  if (isActiveReminder(reminder)) throw new DomainError("INVALID", `reminder ${id} is not in the Archive or Trash`);
  // 018 FR-012 (PRD Q281): one deleted from the Archive goes back there with its completion date.
  if (reminder.deletedAt !== null && reminder.keptDoneAt !== null) {
    const back: Reminder = { ...reminder, doneAt: reminder.keptDoneAt, deletedAt: null, keptDoneAt: null, updatedAt: clock.now() };
    return { upserts: [back], removals: [], sectionCollapsed: null };
  }
  return { upserts: bringBackReminder(reminder, rows, clock.now()), removals: [], sectionCollapsed: sectionCollapsed ? false : null };
}

/** Permanent delete from the Trash (FR-016). */
export function deleteReminderPermanently(id: string, rows: readonly Reminder[]): ReminderChangeSet {
  const reminder = findReminder(rows, id);
  if (reminder.deletedAt === null) throw new DomainError("INVALID", `reminder ${id} is not in the Trash`);
  return { upserts: [], removals: [id], sectionCollapsed: null };
}

/** Collapse or expand the Reminders section (FR-003). Not an edit: no reminder row changes (FR-008). */
export function setRemindersCollapsed(collapsed: boolean, current: boolean): ReminderChangeSet {
  if (collapsed === current) return emptyReminderChangeSet();
  return { upserts: [], removals: [], sectionCollapsed: collapsed };
}

/**
 * Moves a reminder before `beforeId`, or to the end for null (004 FR-017). Renumbered siblings keep
 * their last-edit time; a move to its own place changes nothing.
 */
export function moveReminder(id: string, beforeId: string | null, rows: readonly Reminder[], clock: Clock): ReminderChangeSet {
  const reminder = findActiveReminder(rows, id);
  const active = activeReminders(rows);
  const siblings = active.filter((r) => r.id !== id);
  let index = siblings.length;
  if (beforeId !== null) {
    index = siblings.findIndex((r) => r.id === beforeId);
    if (index < 0) throw new DomainError("INVALID", `${beforeId} is not another active reminder`);
  }
  if (active.findIndex((r) => r.id === id) === index) return emptyReminderChangeSet();
  const placed = positionAt(siblings, index, [id]);
  const moved: Reminder = { ...reminder, position: placed.positions.get(id) ?? reminder.position, updatedAt: clock.now() };
  const renumbered = placed.renumbered;
  const others = renumbered === null ? [] : siblings.map((r) => ({ ...r, position: renumbered.get(r.id) ?? r.position }));
  return { upserts: [moved, ...others], removals: [], sectionCollapsed: null };
}

/**
 * The `beforeId` of a keyboard move among reminders (FR-024): up and down only. `undefined` = nothing
 * happens (an edge of the list, or promote and demote, which reminders do not have).
 */
export function keyboardReminderDest(id: string, key: KeyMove, rows: readonly Reminder[]): string | null | undefined {
  const list = activeReminders(rows);
  const i = list.findIndex((r) => r.id === id);
  if (i < 0) return undefined;
  if (key === "up") return i === 0 ? undefined : (list[i - 1] as Reminder).id;
  if (key === "down") return i === list.length - 1 ? undefined : (list[i + 2]?.id ?? null);
  return undefined;
}

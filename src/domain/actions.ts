/** Every user action as a pure function of the current rows → ChangeSet (research.md §3). */
import { ALERT_LIMITS, DEFAULT_ALERT_SETTINGS, type AlertSettings } from "./alert-settings";
import { crossedThreshold, staleOnReturn, unstaleIfAhead } from "./alerts";
import type { Clock } from "./clock";
import { neighboursOf } from "./list-placement";
import { applyPeriodChange, topOfNonPinned } from "./period-change";
import { bringBack } from "./placement";
import { endPosition } from "./positions";
import { DomainError, emptyChangeSet, isActive, type ChangeSet, type Task } from "./task";
import { normalizeTitle } from "./title";
import { activeSiblings } from "./tree";

export interface CreateInput {
  title: string;
  parentId: string | null;
}

/** Adds a task at the end of its list (FR-011, FR-013). An empty title creates nothing. */
export function create(input: CreateInput, tasks: readonly Task[], clock: Clock, newId: () => string): ChangeSet {
  const title = normalizeTitle(input.title);
  if (title === null) return emptyChangeSet();
  const parent = input.parentId === null ? null : findActive(tasks, input.parentId);
  if (parent !== null && parent.parentId !== null) throw new DomainError("INVALID", "a subtask cannot have subtasks");
  const now = clock.now();
  const siblings = activeSiblings(tasks, parent?.id ?? null);
  const task: Task = {
    id: newId(),
    parentId: parent?.id ?? null,
    titleMd: title,
    position: endPosition(siblings.map((s) => s.position)),
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    deletedAt: null,
    collapsed: false,
    prevSiblingId: null,
    nextSiblingId: null,
    leftWithId: null,
    keptDoneAt: null,
    alertOverrideMin: null,
    staleBaseAt: now,
    staleSince: null,
    wasStale: false,
    lastBlinkAt: null,
    firstBlinkCount: null,
    manuallyPositioned: false,
    lastSignalAt: null,
    detailsMd: "",
    rescheduleForMin: null,
  };
  // FR-014: adding a subtask expands its parent (collapse is not an edit, FR-016).
  const upserts = parent?.collapsed === true ? [{ ...parent, collapsed: false }, task] : [task];
  return { upserts, removals: [] };
}

function find(tasks: readonly Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (task === undefined) throw new DomainError("NOT_FOUND", `task ${id} not found`);
  return task;
}

function findActive(tasks: readonly Task[], id: string): Task {
  const task = find(tasks, id);
  if (!isActive(task)) throw new DomainError("INVALID", `task ${id} is not active`);
  return task;
}

/** Saves a new title (FR-017 to FR-019). Empty or unchanged titles save nothing. */
export function editTitle(id: string, raw: string, tasks: readonly Task[], clock: Clock): ChangeSet {
  const task = findActive(tasks, id);
  const title = normalizeTitle(raw);
  if (title === null || title === task.titleMd) return emptyChangeSet();
  return { upserts: [{ ...task, titleMd: title, updatedAt: clock.now() }], removals: [] };
}

/**
 * Saves the details as the editor wrote them (005 FR-009, FR-012): the stored text is never normalized here,
 * and only `updatedAt` changes with it. Unchanged details save nothing.
 */
export function editDetails(id: string, md: string, tasks: readonly Task[], clock: Clock): ChangeSet {
  const task = findActive(tasks, id);
  if (md === task.detailsMd) return emptyChangeSet();
  return { upserts: [{ ...task, detailsMd: md, updatedAt: clock.now() }], removals: [] };
}

/** Collapse or expand a parent (FR-020). Not an edit: the last-edit time stays (FR-016). */
export function setCollapsed(id: string, collapsed: boolean, tasks: readonly Task[]): ChangeSet {
  const task = findActive(tasks, id);
  if (task.collapsed === collapsed) return emptyChangeSet();
  return { upserts: [{ ...task, collapsed }], removals: [] };
}

type LeaveField = "doneAt" | "deletedAt";

/** Done or delete: the item leaves the active list with the time, its neighbours, and (for a parent) its active subtasks. */
function leave(id: string, field: LeaveField, tasks: readonly Task[], clock: Clock): ChangeSet {
  const task = findActive(tasks, id);
  const now = clock.now();
  const main: Task = {
    ...task,
    [field]: now,
    updatedAt: now,
    ...neighboursOf(activeSiblings(tasks, task.parentId), task.id),
    leftWithId: null,
  };
  const along =
    task.parentId === null
      ? activeSiblings(tasks, task.id).map((s) => ({ ...s, [field]: now, updatedAt: now, leftWithId: task.id }))
      : [];
  return { upserts: [main, ...along], removals: [] };
}

/** Mark done (FR-021, FR-023, FR-024). */
export function markDone(id: string, tasks: readonly Task[], clock: Clock): ChangeSet {
  return leave(id, "doneAt", tasks, clock);
}

/** Move to Trash (FR-022, FR-023, FR-024). */
export function remove(id: string, tasks: readonly Task[], clock: Clock): ChangeSet {
  return leave(id, "deletedAt", tasks, clock);
}

/**
 * 018 FR-010 (PRD Q272, Q281; data-model.md "Transitions"): an Archive entry goes to the Trash with the subtasks that
 * went to the Archive with it, each keeping its completion date in keptDoneAt (the schema refuses a row both done and
 * deleted). Taken-along subtasks keep leftWithId, so the Trash lists them under their parent.
 */
export function trashDone(id: string, tasks: readonly Task[], clock: Clock): ChangeSet {
  const task = find(tasks, id);
  if (task.doneAt === null || task.deletedAt !== null) throw new DomainError("INVALID", `task ${id} is not in the Archive`);
  const now = clock.now();
  const toTrash = (t: Task): Task => ({ ...t, doneAt: null, deletedAt: now, keptDoneAt: t.doneAt, updatedAt: now });
  const along = tasks.filter((t) => t.leftWithId === id && t.doneAt !== null && t.deletedAt === null);
  // Deleted alone, a subtask that went to the Archive with its parent is listed on its own in the Trash.
  return { upserts: [{ ...toTrash(task), leftWithId: null }, ...along.map(toTrash)], removals: [] };
}

/**
 * 018 FR-012 (PRD Q281): a Trash row deleted from the Archive goes back to the Archive with its completion date, and
 * the rows that went with it follow; restored alone, a taken-along subtask is listed on its own there.
 */
function restoreToArchive(task: Task, tasks: readonly Task[], now: number): ChangeSet {
  const toArchive = (t: Task): Task => ({ ...t, doneAt: t.keptDoneAt, deletedAt: null, keptDoneAt: null, updatedAt: now });
  const along = tasks.filter((t) => t.leftWithId === task.id && t.deletedAt !== null && t.keptDoneAt !== null);
  return { upserts: [{ ...toArchive(task), leftWithId: null }, ...along.map(toArchive)], removals: [] };
}

/**
 * Restore from the Archive or Trash (FR-032, FR-034, FR-036, FR-037). Restored rows past their threshold come
 * back stale, and a stale top-level task rejoins the stale group: its manual mark is cleared (003 FR-018, FR-028).
 * A row that kept its stale mark while done or deleted is evaluated again first: if its stale moment under the
 * current period is still in the future, it comes back not stale (012 FR-028, PRD Q162).
 */
export function restore(id: string, tasks: readonly Task[], clock: Clock, settings: AlertSettings = DEFAULT_ALERT_SETTINGS): ChangeSet {
  const task = find(tasks, id);
  if (isActive(task)) throw new DomainError("INVALID", `task ${id} is not in the Archive or Trash`);
  const now = clock.now();
  if (task.deletedAt !== null && task.keptDoneAt !== null) return restoreToArchive(task, tasks, now);
  const back = bringBack(task, tasks, now, { expandParent: true });
  // Only the rows coming back; bringBack may also renumber or expand rows that were already active.
  const returning = new Set(tasks.filter((t) => !isActive(t)).map((t) => t.id));
  const upserts = back.upserts.map((t) => {
    if (!returning.has(t.id)) return t;
    const [evaluated = t] = staleOnReturn([unstaleIfAhead(t, settings, now) ?? t], settings, now);
    return evaluated.staleSince !== null && evaluated.parentId === null && evaluated.manuallyPositioned
      ? { ...evaluated, manuallyPositioned: false }
      : evaluated;
  });
  return { upserts, removals: back.removals };
}

/**
 * Reschedule an active task, stale or not (003 FR-029 to FR-032; 015 FR-004, FR-005, FR-008, PRD Q203, Q207): the
 * stale state clears and the countdown restarts from now, with the quick duration `forMin` when one was chosen, else
 * the reschedule tolerance. A stale task keeps its stale history; a task that was not stale is not marked as having
 * been stale. A pinned top-level task moves to the top of the non-pinned tasks; a manually positioned task and a
 * subtask keep their place. A task past its threshold whose stale state could not be saved yet (a failed tick save)
 * is shown stale, so it counts as stale (FR-044).
 */
export function reschedule(
  id: string,
  tasks: readonly Task[],
  clock: Clock,
  settings: AlertSettings = DEFAULT_ALERT_SETTINGS,
  forMin: number | null = null,
): ChangeSet {
  const task = findActive(tasks, id);
  const now = clock.now();
  if (forMin !== null) {
    const { min, max } = ALERT_LIMITS.quickReschedule1Min;
    if (!Number.isInteger(forMin) || forMin < min || forMin > max) throw new DomainError("INVALID", `forMin must be ${String(min)}–${String(max)} minutes`);
  }
  const stale = (t: Task) => t.staleSince !== null || crossedThreshold(t, settings, now);
  const pinned = (t: Task) => t.parentId === null && !t.manuallyPositioned && stale(t);
  const position = pinned(task) ? topOfNonPinned(tasks, id, pinned) : task.position;
  return {
    upserts: [
      {
        ...task,
        staleSince: null,
        firstBlinkCount: null,
        staleBaseAt: now,
        wasStale: task.wasStale || stale(task),
        rescheduleForMin: forMin,
        updatedAt: now,
        position,
      },
    ],
    removals: [],
  };
}

/**
 * Set or clear a task's alert override (003 FR-036): null follows the global alert period. The next tick applies
 * the new threshold to a task that is not yet stale; a stale task never rescheduled whose new stale moment is in
 * the future stops being stale at once (012 FR-026, PRD Q158, replacing 003 FR-039). Only this task's last-edit
 * time changes (FR-031).
 */
export function setAlertOverride(
  id: string,
  minutes: number | null,
  tasks: readonly Task[],
  clock: Clock,
  settings: AlertSettings = DEFAULT_ALERT_SETTINGS,
): ChangeSet {
  const task = findActive(tasks, id);
  const { min, max } = ALERT_LIMITS.alertPeriodMin;
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < min || minutes > max)) {
    throw new DomainError("INVALID", `alert override ${String(minutes)} is outside ${String(min)}–${String(max)} minutes`);
  }
  if (task.alertOverrideMin === minutes) return emptyChangeSet();
  const now = clock.now();
  const edited: Task = { ...task, alertOverrideMin: minutes, updatedAt: now };
  const rows = tasks.map((t) => (t.id === id ? edited : t));
  const [back = edited] = applyPeriodChange(rows, settings, now, new Set([id])).upserts;
  return { upserts: [back], removals: [] };
}

/** Permanent delete from the Trash, with the rows that went with it (FR-034). */
export function deletePermanently(id: string, tasks: readonly Task[]): ChangeSet {
  const task = find(tasks, id);
  if (task.deletedAt === null) throw new DomainError("INVALID", `task ${id} is not in the Trash`);
  const along = tasks.filter((t) => t.leftWithId === id).map((t) => t.id);
  return { upserts: [], removals: [id, ...along] };
}

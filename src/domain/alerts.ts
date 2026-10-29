/**
 * The alert engine as pure functions of the rows, the settings, the time and the main view's visibility
 * (003 research §2; PRD A4, B4). Main calls it on each tick and saves what it returns.
 */
import type { AlertSettings } from "./alert-settings";
import { isActive, type Task } from "./task";

const MINUTE = 60_000;

export interface Visibility {
  visible: boolean;
  visibleSince: number | null;
}

export interface Episode {
  id: string;
  blinks: 1 | 3;
}

export interface AlertInput {
  tasks: readonly Task[];
  settings: AlertSettings;
  now: number;
  visibility: Visibility;
}

/**
 * The effective alert period before the first reschedule (FR-003); after one, the quick duration of the last
 * reschedule when one was chosen, else the reschedule tolerance (FR-004; 015 FR-008, PRD Q207).
 */
export function thresholdMs(task: Task, settings: AlertSettings): number {
  const minutes =
    task.staleBaseAt === task.createdAt ? (task.alertOverrideMin ?? settings.alertPeriodMin) : (task.rescheduleForMin ?? settings.rescheduleToleranceMin);
  return minutes * MINUTE;
}

export function staleMomentOf(task: Task, settings: AlertSettings): number {
  return task.staleBaseAt + thresholdMs(task, settings);
}

/** Strictly past the threshold, at stored millisecond precision (FR-004). */
export function crossedThreshold(task: Task, settings: AlertSettings, now: number): boolean {
  return now - task.staleBaseAt > thresholdMs(task, settings);
}

/** A top-level row, or a subtask whose parent is expanded (FR-021). */
export function isShown(task: Task, byId: ReadonlyMap<string, Task>): boolean {
  if (task.parentId === null) return true;
  const parent = byId.get(task.parentId);
  return parent === undefined || !parent.collapsed;
}

/** An auto-sorted stale top-level task: pinned to the stale group (FR-024, FR-026). */
export function isPinned(task: Task): boolean {
  return task.parentId === null && isActive(task) && task.staleSince !== null && !task.manuallyPositioned;
}

/**
 * Rows coming back from the Archive or Trash (003 FR-018 exception): a row past its threshold becomes stale
 * at its real crossing moment, and plays the full 3 blinks when the main view is next visible.
 */
export function staleOnReturn(rows: readonly Task[], settings: AlertSettings, now: number): Task[] {
  return rows.map((t) =>
    t.staleSince === null && isActive(t) && crossedThreshold(t, settings, now)
      ? { ...t, staleSince: staleMomentOf(t, settings), wasStale: true, firstBlinkCount: 3 }
      : t,
  );
}

/**
 * 012 FR-026 (PRD Q158): a stale task never rescheduled whose stale moment under `settings` is still in the future
 * is not late any more: its stale mark and blink bookkeeping clear, its stale history stays, and the next tick
 * makes it stale again at that moment like a first time. Null when the rule does not apply. updatedAt is kept.
 */
export function unstaleIfAhead(task: Task, settings: AlertSettings, now: number): Task | null {
  if (task.staleSince === null || task.staleBaseAt !== task.createdAt || !isActive(task)) return null;
  if (staleMomentOf(task, settings) <= now) return null;
  return { ...task, staleSince: null, lastBlinkAt: null, lastSignalAt: null, firstBlinkCount: null };
}

/** The first episode has not played yet; a stale moment pushed into the future by a clock change does not count. */
function firstBlinkPending(task: Task, now: number): boolean {
  if (task.staleSince === null) return false;
  if (task.lastBlinkAt === null) return true;
  return task.lastBlinkAt < task.staleSince && task.staleSince <= now;
}

/** Re-blinks of a subtask count from its last blink or its parent's last signal for it, whichever is later. */
function lastAlertOf(task: Task): number | null {
  if (task.lastBlinkAt === null) return task.lastSignalAt;
  if (task.lastSignalAt === null) return task.lastBlinkAt;
  return Math.max(task.lastBlinkAt, task.lastSignalAt);
}

/**
 * One tick: clock-back reset, then tasks crossing their threshold, then the episodes to play now, then the
 * collapsed parents' signals for their hidden subtasks (003 FR-021a).
 * Rows change only in their alert fields; updatedAt never changes (FR-044).
 */
export function evaluateAlerts({ tasks, settings, now, visibility }: AlertInput): { upserts: Task[]; episodes: Episode[] } {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const changed = new Set<string>();
  const update = (task: Task, patch: Partial<Task>) => {
    rows.set(task.id, { ...task, ...patch });
    changed.add(task.id);
  };
  const active = tasks.filter(isActive).map((t) => t.id);
  const current = (id: string) => rows.get(id) as Task;

  // 1. Clock moved back: a last blink in the future counts as now (FR-045a).
  for (const id of active) {
    const t = current(id);
    if (t.lastBlinkAt !== null && t.lastBlinkAt > now) update(t, { lastBlinkAt: now });
    const u = current(id);
    if (u.lastSignalAt !== null && u.lastSignalAt > now) update(u, { lastSignalAt: now });
  }

  // 2. Becoming stale (FR-004, FR-006, FR-017, FR-018).
  const { visible, visibleSince } = visibility;
  for (const id of active) {
    const t = current(id);
    if (t.staleSince !== null || !crossedThreshold(t, settings, now)) continue;
    const moment = staleMomentOf(t, settings);
    // A subtask hidden in a collapsed parent blinks once when it is first shown (FR-021a).
    const seenGoingStale = visible && visibleSince !== null && moment >= visibleSince && isShown(t, rows);
    update(t, { staleSince: moment, wasStale: true, firstBlinkCount: seenGoingStale ? 3 : 1 });
  }

  // 3. Episodes, only while the main view is visible and only for shown rows (FR-019, FR-021).
  const episodes: Episode[] = [];
  if (visible) {
    const interval = settings.reblinkIntervalMin * MINUTE;
    for (const id of active) {
      const t = current(id);
      if (t.staleSince === null || !isShown(t, rows)) continue;
      const lastAlert = lastAlertOf(t);
      let blinks: 1 | 3 | null = null;
      if (firstBlinkPending(t, now)) blinks = t.firstBlinkCount ?? 1;
      else if (lastAlert !== null && now - lastAlert >= interval) blinks = 3;
      if (blinks === null) continue;
      episodes.push({ id, blinks });
      update(t, { lastBlinkAt: now });
    }

    // 4. A collapsed parent blinks once for its hidden stale subtasks going stale or re-blinking (FR-021a).
    //    Collapsing alone never makes it blink: a first signal needs the subtask's first blink still pending.
    const signalled = new Set<string>();
    for (const id of active) {
      const t = current(id);
      if (t.staleSince === null || t.parentId === null || isShown(t, rows)) continue;
      const lastAlert = lastAlertOf(t);
      const firstSignal = firstBlinkPending(t, now) && (t.lastSignalAt === null || t.lastSignalAt < t.staleSince);
      if (!firstSignal && !(lastAlert !== null && now - lastAlert >= interval)) continue;
      update(t, { lastSignalAt: now });
      signalled.add(t.parentId);
    }
    for (const parentId of signalled) {
      // A parent playing its own episode now plays only that one; the signal still counts as given.
      if (!episodes.some((e) => e.id === parentId)) episodes.push({ id: parentId, blinks: 1 });
    }
  }

  return { upserts: [...changed].map(current), episodes };
}

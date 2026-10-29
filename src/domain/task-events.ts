/** A task's history (015 PRD Q206, Q210, Q214–Q217; data-model.md "TaskEvent"). */
import type { ChangeSet, Task } from "./task";

/** What happened; the `task_events.kind` column's allowed values (migration 011). */
export type TaskEventKind =
  | "created"
  | "stale"
  | "unstale"
  | "rescheduled"
  | "override_set"
  | "override_changed"
  | "override_cleared"
  | "done"
  | "trashed"
  | "restored";

export const TASK_EVENT_KINDS: readonly TaskEventKind[] = [
  "created",
  "stale",
  "unstale",
  "rescheduled",
  "override_set",
  "override_changed",
  "override_cleared",
  "done",
  "trashed",
  "restored",
];

/**
 * One entry of a task's history. `at` is when it happened (a `stale` event carries the real stale moment, FR-018);
 * `detail` is minutes: the quick duration of a `rescheduled` (null = the tolerance) or the new override of an
 * `override_set`/`override_changed`, null otherwise. `seq` is the recording order, set when read from the database.
 */
export interface TaskEvent {
  id: string;
  taskId: string;
  kind: TaskEventKind;
  at: number;
  detail: number | null;
  seq?: number;
}

/** The event rows one change writes: new events, merged override events (Q214), and ids an undo removes (Q215). */
export interface EventWrite {
  inserts: TaskEvent[];
  updates: TaskEvent[];
  removals: string[];
}

/** Who wrote a change: what events its rows give (research §2, data-model.md "Derivation"). */
export type EventOrigin = "action" | "tick" | "period" | "undo" | "import";

export interface DeriveContext {
  now: number;
  newId: () => string;
  origin: EventOrigin;
  /** Each changed task's latest recorded event, for the override merge (Q214). */
  lastEvents: ReadonlyMap<string, TaskEvent>;
  /** 016 FR-011 (PRD Q229): the reschedule tolerance in force, recorded as a plain reschedule's duration. */
  toleranceMin: number;
}

/** An override change this soon after the task's latest event, when that event is an override set or change, merges. */
const OVERRIDE_MERGE_MS = 60_000;

/**
 * The events a change gives, from what it does to each row (research §2): one rule per field, in this order for
 * one row: created, restored, rescheduled, the override, unstale, stale, done, trashed (so a restore that makes a
 * task stale reads restored, then stale; an override that ends the stale state reads the override, then unstale).
 * The tick writes only `stale`, a period change only `unstale`; an undo removes events instead, and an import copies
 * the file's (FR-017, FR-019, FR-023).
 */
export function deriveEvents(before: readonly Task[], changes: ChangeSet, ctx: DeriveContext): EventWrite {
  const out: EventWrite = { inserts: [], updates: [], removals: [] };
  if (ctx.origin === "undo" || ctx.origin === "import") return out;
  const old = new Map(before.map((t) => [t.id, t]));
  const allow = (kind: TaskEventKind) => ctx.origin === "action" || (ctx.origin === "tick" ? kind === "stale" : kind === "unstale");
  for (const u of changes.upserts) {
    const b = old.get(u.id);
    const own: TaskEvent[] = [];
    const add = (kind: TaskEventKind, at: number, detail: number | null = null) => {
      if (allow(kind)) own.push({ id: ctx.newId(), taskId: u.id, kind, at, detail });
    };
    if (b === undefined) {
      add("created", u.createdAt);
      out.inserts.push(...own);
      continue;
    }
    // 018 (data-model.md): an Archive delete keeps the completion date in keptDoneAt, so it is trashed, not restored;
    // its restore back to the Archive is restored, not done again.
    const archiveToTrash = b.doneAt !== null && u.doneAt === null && u.deletedAt !== null && u.keptDoneAt === b.doneAt;
    const trashToArchive = b.deletedAt !== null && b.keptDoneAt !== null && u.deletedAt === null && u.doneAt === b.keptDoneAt;
    if (!archiveToTrash && ((b.doneAt !== null && u.doneAt === null) || (b.deletedAt !== null && u.deletedAt === null))) add("restored", ctx.now);
    const rescheduled = b.staleBaseAt !== u.staleBaseAt;
    if (rescheduled) add("rescheduled", ctx.now, u.rescheduleForMin ?? ctx.toleranceMin);
    if (b.alertOverrideMin !== u.alertOverrideMin) {
      if (u.alertOverrideMin === null) add("override_cleared", ctx.now);
      else {
        const last = ctx.lastEvents.get(u.id);
        const merge =
          own.length === 0 &&
          ctx.origin === "action" &&
          last !== undefined &&
          (last.kind === "override_set" || last.kind === "override_changed") &&
          ctx.now - last.at < OVERRIDE_MERGE_MS;
        if (merge) out.updates.push({ ...last, at: ctx.now, detail: u.alertOverrideMin });
        else add(b.alertOverrideMin === null ? "override_set" : "override_changed", ctx.now, u.alertOverrideMin);
      }
    }
    if (!rescheduled && b.staleSince !== null && u.staleSince === null) add("unstale", ctx.now);
    if (b.staleSince === null && u.staleSince !== null) add("stale", u.staleSince);
    if (!trashToArchive && b.doneAt === null && u.doneAt !== null) add("done", u.doneAt);
    if (b.deletedAt === null && u.deletedAt !== null) add("trashed", u.deletedAt);
    out.inserts.push(...own);
  }
  return out;
}

/** One line of the history list (data-model.md "HistoryEntry"); `wasStale` has no time. */
export interface HistoryEntry {
  kind: TaskEventKind | "wasStale";
  at: number | null;
  detail: number | null;
  /** From the task's stored dates, for a task from before the history was kept (FR-020, Q217). */
  derived: boolean;
}

/**
 * A task's history, newest first (Q210), by time then recording order (FR-016b). A task with no `created` event is
 * from before the history was kept: the entries its stored dates give are added (created, stale since, done,
 * deleted), each left out when a recorded event of the same kind has the same time, and a dateless "Was stale" just
 * above Created when it was stale and no stale entry is listed (FR-020, Q217).
 */
export function historyOf(task: Task, events: readonly TaskEvent[]): HistoryEntry[] {
  const own = events
    .filter((e) => e.taskId === task.id)
    .sort((a, b) => a.at - b.at || (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER));
  const list: HistoryEntry[] = own.map((e) => ({ kind: e.kind, at: e.at, detail: e.detail, derived: false }));
  if (own.some((e) => e.kind === "created")) return list.reverse();
  const covered = (kind: TaskEventKind, at: number) => own.some((e) => e.kind === kind && e.at === at);
  const derived: HistoryEntry[] = [];
  const derive = (kind: TaskEventKind, at: number | null) => {
    if (at !== null && !covered(kind, at)) derived.push({ kind, at, detail: null, derived: true });
  };
  derive("stale", task.staleSince);
  derive("done", task.doneAt);
  derive("trashed", task.deletedAt);
  // Derived entries sort among the recorded ones by time; a recorded event at the same time stays later (above).
  const merged = [...derived, ...list].sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || Number(!a.derived) - Number(!b.derived));
  const newestFirst = merged.reverse();
  const created: HistoryEntry = { kind: "created", at: task.createdAt, detail: null, derived: true };
  if (task.wasStale && !newestFirst.some((e) => e.kind === "stale")) newestFirst.push({ kind: "wasStale", at: null, detail: null, derived: true });
  newestFirst.push(created);
  return newestFirst;
}

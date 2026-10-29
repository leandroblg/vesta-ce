import type { EventWrite } from "./task-events";

/** A task or subtask: the `tasks` table in camelCase (data-model.md). */
export interface Task {
  id: string;
  parentId: string | null;
  titleMd: string;
  position: number;
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  deletedAt: number | null;
  collapsed: boolean;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
  leftWithId: string | null;
  /** 018 (PRD Q272, Q281): in the Trash, the completion date of a done item deleted from the Archive; else null. */
  keptDoneAt: number | null;
  /** Alert fields (003 data-model.md). Null override = follow the global alert period. */
  alertOverrideMin: number | null;
  /** Creation time until the first reschedule, then the latest reschedule (FR-004). */
  staleBaseAt: number;
  /** The stale moment (base + threshold); null = not stale (FR-006). */
  staleSince: number | null;
  wasStale: boolean;
  lastBlinkAt: number | null;
  /** Blinks of the first episode, decided when the task became stale (FR-017, FR-018, FR-021a). */
  firstBlinkCount: 1 | 3 | null;
  /** Set by drag and drop (feature 004); exempts a stale task from age sorting (FR-026). */
  manuallyPositioned: boolean;
  /** Subtasks only: when the collapsed parent last blinked for this hidden subtask (FR-021a). */
  lastSignalAt: number | null;
  /** Markdown in the details scope; empty means no details (005 data-model.md). */
  detailsMd: string;
  /** The quick duration of the last reschedule in minutes; null = the reschedule tolerance applies (015 Q207). */
  rescheduleForMin: number | null;
}

export type TaskState = "active" | "done" | "deleted";

export function stateOf(task: Task): TaskState {
  if (task.doneAt !== null) return "done";
  if (task.deletedAt !== null) return "deleted";
  return "active";
}

export function isActive(task: Task): boolean {
  return task.doneAt === null && task.deletedAt === null;
}

/** What one action writes; applied in a single transaction. */
export interface ChangeSet {
  upserts: Task[];
  removals: string[];
  /** 015: the history rows written with this change, filled in by main (research §4). */
  events?: EventWrite;
}

export const emptyChangeSet = (): ChangeSet => ({ upserts: [], removals: [] });

/** A rule violation: the action is not allowed for this item (maps to INVALID / NOT_FOUND). */
export class DomainError extends Error {
  constructor(
    readonly code: "INVALID" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

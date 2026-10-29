/** Views over the task rows (FR-005, FR-031, FR-033; 003 FR-024 to FR-027). */
import { isPinned } from "./alerts";
import { isActive, type Task } from "./task";

export interface TreeNode {
  task: Task;
  subtasks: Task[];
}

/** Equal positions: creation time, then id, so every installation shows the same order (008 FR-036). */
const byPosition = (a: Task, b: Task) =>
  a.position - b.position || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Active siblings in one list (top level when parentId is null), in order. */
export function activeSiblings(tasks: readonly Task[], parentId: string | null): Task[] {
  return tasks.filter((t) => t.parentId === parentId && isActive(t)).sort(byPosition);
}

export function hasActiveSubtasks(task: Task, tasks: readonly Task[]): boolean {
  return tasks.some((t) => t.parentId === task.id && isActive(t));
}

/** Oldest first; equal creation times by saved position, then id (003 FR-024). */
const byAge = (a: Task, b: Task) => a.createdAt - b.createdAt || a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The active list: auto-sorted stale tasks first, oldest first, then every other top-level task in its saved
 * order; each carries its subtasks, never sorted by age. `exempt` rows (an open editor, menu or override
 * panel) keep their saved place until they close (003 FR-024 to FR-027). Pinning is a view: positions never change.
 */
export function activeTree(tasks: readonly Task[], options: { exempt?: ReadonlySet<string> } = {}): TreeNode[] {
  const exempt = options.exempt ?? new Set<string>();
  const top = activeSiblings(tasks, null);
  const pinned = top.filter((t) => isPinned(t) && !exempt.has(t.id)).sort(byAge);
  const pinnedIds = new Set(pinned.map((t) => t.id));
  const rest = top.filter((t) => !pinnedIds.has(t.id));
  return [...pinned, ...rest].map((task) => ({ task, subtasks: activeSiblings(tasks, task.id) }));
}

/** The manual order: active top-level tasks that are not pinned, by position (004 data-model). */
export function manualOrder(tasks: readonly Task[]): Task[] {
  return activeSiblings(tasks, null).filter((t) => !isPinned(t));
}

export interface ArchiveEntry {
  task: Task;
  /** Title of the parent while its row exists, for a subtask that left on its own. */
  parentTitle: string | null;
  /** Subtasks that went along with this entry, in their order. */
  subtasks: Task[];
}

function entries(tasks: readonly Task[], field: "doneAt" | "deletedAt"): ArchiveEntry[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks
    .filter((t) => t[field] !== null && t.leftWithId === null)
    .sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0))
    .map((task) => ({
      task,
      parentTitle: task.parentId === null ? null : (byId.get(task.parentId)?.titleMd ?? null),
      subtasks: tasks.filter((t) => t.leftWithId === task.id && t[field] !== null).sort(byPosition),
    }));
}

/** Done entries newest first (FR-031). */
export function archiveView(tasks: readonly Task[]): ArchiveEntry[] {
  return entries(tasks, "doneAt");
}

/** Deleted entries newest first (FR-033). */
export function trashView(tasks: readonly Task[]): ArchiveEntry[] {
  return entries(tasks, "deletedAt");
}

/** Every task and subtask in each view (FR-002). */
export function counts(tasks: readonly Task[]): { archive: number; trash: number } {
  return {
    archive: tasks.filter((t) => t.doneAt !== null).length,
    trash: tasks.filter((t) => t.deletedAt !== null).length,
  };
}

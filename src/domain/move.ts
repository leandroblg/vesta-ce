/** Moving tasks and subtasks: destinations shared by drag and keyboard (004 research §3, §4; data-model.md). */
import type { AlertSettings } from "./alert-settings";
import { crossedThreshold, isPinned } from "./alerts";
import type { Clock } from "./clock";
import { positionAt } from "./list-placement";
import { DomainError, emptyChangeSet, isActive, type ChangeSet, type Task } from "./task";
import { activeSiblings, activeTree, manualOrder } from "./tree";

/** Where a moved task goes. `beforeId` names a sibling in the destination list; null = the end of it. */
export type MoveDest =
  | { kind: "top"; beforeId: string | null } // before this non-pinned top-level task
  | { kind: "sub"; parentId: string; beforeId: string | null } // before this subtask of parentId
  | { kind: "group" }; // rejoin the stale group (a non-stale task lands just below it)

/** The keyboard moves (FR-024 to FR-025): Alt+Up, Alt+Down, Alt+Left, Alt+Right. */
export type KeyMove = "up" | "down" | "promote" | "demote";


function findActive(tasks: readonly Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (task === undefined) throw new DomainError("NOT_FOUND", `task ${id} not found`);
  if (!isActive(task)) throw new DomainError("INVALID", `task ${id} is not active`);
  return task;
}

/** The index `beforeId` names in `siblings` (the end for null); INVALID when it is not one of them. */
function indexOf(siblings: readonly Task[], beforeId: string | null, what: string): number {
  if (beforeId === null) return siblings.length;
  const i = siblings.findIndex((s) => s.id === beforeId);
  if (i < 0) throw new DomainError("INVALID", `${beforeId} is not ${what}`);
  return i;
}

/**
 * Moves a task or subtask to `dest` (004 research §3): validates, places it among the destination
 * siblings, and returns every changed row as one ChangeSet. A move that changes nothing is empty.
 * Renumbered siblings keep their last-edit time (001 research §4).
 */
export function moveTask(id: string, requested: MoveDest, tasks: readonly Task[], clock: Clock, settings: AlertSettings): ChangeSet {
  const task = findActive(tasks, id);
  const now = clock.now();
  // Stale at release: its stale moment is saved, or it is past its threshold and the tick has not run yet (FR-014).
  const stale = task.staleSince !== null || crossedThreshold(task, settings, now);
  if (requested.kind === "group" && stale) return rejoin(task, tasks, now);
  // A non-stale item over the group lands just below it (FR-013).
  const dest: Exclude<MoveDest, { kind: "group" }> =
    requested.kind === "group" ? { kind: "top", beforeId: manualOrder(tasks).find((t) => t.id !== id)?.id ?? null } : requested;
  // A top-level task's subtasks follow it when it lands as a subtask (FR-008).
  const children = task.parentId === null ? activeSiblings(tasks, task.id) : [];
  const childIds = new Set(children.map((c) => c.id));
  const parentId = dest.kind === "sub" ? dest.parentId : null;
  let parent: Task | null = null;
  let siblings: Task[];
  if (dest.kind === "sub") {
    parent = findActive(tasks, dest.parentId);
    // One level only (FR-009): the parent is top level, and neither the task nor one of its subtasks.
    if (parent.parentId !== null || parent.id === task.id) throw new DomainError("INVALID", `${parent.id} cannot hold subtasks here`);
    siblings = activeSiblings(tasks, parent.id).filter((t) => t.id !== id);
  } else {
    siblings = manualOrder(tasks).filter((t) => t.id !== id);
  }
  if (dest.beforeId !== null && childIds.has(dest.beforeId)) throw new DomainError("INVALID", `${dest.beforeId} moves with ${id}`);
  // Its current index among the same siblings, when it stays in the same list (-1 otherwise).
  const current =
    task.parentId === parentId && !isPinned(task)
      ? (parentId === null ? manualOrder(tasks) : activeSiblings(tasks, parentId)).findIndex((t) => t.id === id)
      : -1;
  // "Before itself" is its own place (FR-009a).
  const index = dest.beforeId === id && current >= 0 ? current : indexOf(siblings, dest.beforeId, "an active sibling in the destination list");

  // The mark (FR-014, FR-015, FR-015a): set for a stale item landing at the top level, kept for a
  // non-stale top-level task, cleared for anything landing as a subtask.
  const mark = parent !== null ? false : stale ? true : task.parentId === null ? task.manuallyPositioned : false;

  // No-op: same parent, same place among the same siblings, same mark (FR-003, FR-020).
  if (current >= 0 && current === index && mark === task.manuallyPositioned) return emptyChangeSet();

  const carried = parent === null ? [] : children;
  const placed = positionAt(siblings, index, [id, ...carried.map((c) => c.id)]);
  const at = (t: Task) => placed.positions.get(t.id) ?? t.position;
  const moved: Task = {
    ...task,
    parentId,
    position: at(task),
    manuallyPositioned: mark,
    updatedAt: now,
    // A demoted parent's subtasks become its siblings; its collapse toggle no longer applies (FR-019).
    collapsed: parent !== null ? false : task.collapsed,
  };
  const upserts: Task[] = [moved, ...carried.map((c) => ({ ...c, parentId, position: at(c), manuallyPositioned: false, updatedAt: now }))];
  // A collapsed target parent is expanded so the moved item shows; collapse is not an edit (FR-010).
  if (parent?.collapsed === true) upserts.unshift({ ...parent, collapsed: false });
  const renumbered = placed.renumbered;
  if (renumbered !== null) for (const s of siblings) upserts.push({ ...s, position: renumbered.get(s.id) ?? s.position });
  return { upserts, removals: [] };
}

/**
 * A stale task or subtask rejoins the stale group (FR-013, Clarifications): its mark is
 * cleared, so it is sorted by age again; it keeps a place at the top of the manual order for when it
 * leaves the group. A task already in the group does not move.
 */
function rejoin(task: Task, tasks: readonly Task[], now: number): ChangeSet {
  if (isPinned(task)) return emptyChangeSet();
  const siblings = manualOrder(tasks).filter((t) => t.id !== task.id);
  const placed = positionAt(siblings, 0, [task.id]);
  const back: Task = { ...task, parentId: null, position: placed.positions.get(task.id) ?? task.position, manuallyPositioned: false, updatedAt: now };
  const renumbered = placed.renumbered;
  const others = renumbered === null ? [] : siblings.map((s) => ({ ...s, position: renumbered.get(s.id) ?? s.position }));
  return { upserts: [back, ...others], removals: [] };
}

/**
 * The destination of a keyboard move (FR-024 to FR-026; research §4), over the list as shown: up/down
 * among siblings (a parent moves as one), Alt+Right demotes under the previous top-level task, Alt+Left
 * promotes right after the parent. Null = nothing happens. moveTask re-checks staleness and the mark.
 */
export function keyboardDest(id: string, key: KeyMove, tasks: readonly Task[]): MoveDest | null {
  const task = tasks.find((t) => t.id === id);
  if (task === undefined || !isActive(task)) return null;
  const tree = activeTree(tasks);
  if (task.parentId === null) {
    const tops = tree.map((n) => n.task);
    const i = tops.findIndex((t) => t.id === id);
    const prev = tops[i - 1];
    if (key === "promote") return null;
    if (key === "demote") return prev === undefined ? null : { kind: "sub", parentId: prev.id, beforeId: null };
    if (isPinned(task)) {
      // In the group: nothing goes up; down leaves the group past the first task below it (FR-025).
      if (key === "up") return null;
      const manual = manualOrder(tasks);
      if (manual.length > 0) return { kind: "top", beforeId: manual[1]?.id ?? null };
      return tops[i + 1] === undefined ? null : { kind: "top", beforeId: null };
    }
    if (key === "up") {
      // The first place below the group (or the first place at all): a positioned-by-hand stale task rejoins.
      if (prev === undefined || isPinned(prev)) return task.staleSince !== null && task.manuallyPositioned ? { kind: "group" } : null;
      return { kind: "top", beforeId: prev.id };
    }
    if (tops[i + 1] === undefined) return null;
    return { kind: "top", beforeId: tops[i + 2]?.id ?? null };
  }
  const parent = tasks.find((t) => t.id === task.parentId);
  if (parent === undefined) return null;
  if (key === "demote") return null;
  if (key === "promote") {
    const manual = manualOrder(tasks);
    if (isPinned(parent)) return { kind: "top", beforeId: manual[0]?.id ?? null };
    const k = manual.findIndex((t) => t.id === parent.id);
    return { kind: "top", beforeId: manual[k + 1]?.id ?? null };
  }
  const sibs = activeSiblings(tasks, parent.id);
  const j = sibs.findIndex((t) => t.id === id);
  if (key === "up") return j <= 0 ? null : { kind: "sub", parentId: parent.id, beforeId: (sibs[j - 1] as Task).id };
  if (j === sibs.length - 1) return null;
  return { kind: "sub", parentId: parent.id, beforeId: sibs[j + 2]?.id ?? null };
}

/** Position N of M in the shown list (the top level counts the stale group), and the parent's title (FR-027). */
export function positionInList(id: string, tasks: readonly Task[]): { n: number; m: number; parentTitle: string | null } {
  const tree = activeTree(tasks);
  const top = tree.findIndex((n) => n.task.id === id);
  if (top >= 0) return { n: top + 1, m: tree.length, parentTitle: null };
  for (const node of tree) {
    const j = node.subtasks.findIndex((s) => s.id === id);
    if (j >= 0) return { n: j + 1, m: node.subtasks.length, parentTitle: node.task.titleMd };
  }
  return { n: 0, m: 0, parentTitle: null };
}

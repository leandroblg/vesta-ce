/**
 * What a change of the alert period does to stale tasks (012 FR-026 to FR-031, PRD Q158, research §10). Kept out
 * of alerts.ts because the placement needs the tree, which imports alerts.ts.
 */
import type { AlertSettings } from "./alert-settings";
import { isPinned, unstaleIfAhead } from "./alerts";
import { between } from "./positions";
import { isActive, type ChangeSet, type Task } from "./task";
import { activeSiblings } from "./tree";

/**
 * The position at the top of the top-level tasks that are not pinned (003 FR-031, 012 FR-029): where a pinned task
 * goes when it stops being stale. `pinned` says which other rows still count as pinned.
 */
export function topOfNonPinned(tasks: readonly Task[], id: string, pinned: (t: Task) => boolean): number {
  const others = activeSiblings(tasks, null).filter((t) => t.id !== id && !pinned(t));
  return between(null, others.length === 0 ? null : Math.min(...others.map((t) => t.position)));
}

/** The lowest position among active top-level tasks that are not pinned, or null with none. */
function lowestNonPinned(tasks: readonly Task[]): number | null {
  let low: number | null = null;
  for (const t of activeSiblings(tasks, null)) {
    if (isPinned(t)) continue;
    if (low === null || t.position < low) low = t.position;
  }
  return low;
}

/**
 * Applies the un-stale rule after a period change: to every active task following the global period (no override)
 * for a global change, or to `changedIds` for an override change. A pinned task that stops being stale moves to the
 * top of the non-pinned tasks, the oldest ending on top; a manually positioned one keeps its place. Rows keep their
 * updatedAt (FR-031); the caller stamps the edit of an override itself.
 */
export function applyPeriodChange(
  tasks: readonly Task[],
  settings: AlertSettings,
  now: number,
  changedIds?: ReadonlySet<string>,
): ChangeSet {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const candidates = tasks.filter(
    (t) => isActive(t) && (changedIds === undefined ? t.alertOverrideMin === null : changedIds.has(t.id)),
  );
  // Newest first, so that each moved task lands above the previous one and the oldest ends on top.
  const ordered = [...candidates].sort((a, b) => b.createdAt - a.createdAt || b.position - a.position);
  const back = new Map<string, Task>();
  for (const task of ordered) {
    const un = unstaleIfAhead(task, settings, now);
    if (un !== null) back.set(task.id, un);
  }
  // The top of the non-pinned top-level tasks, computed once; each moved task goes above the last one moved.
  let top: number | null | undefined;
  const changed: string[] = [];
  for (const task of ordered) {
    const un = back.get(task.id);
    if (un === undefined) continue;
    let moved = un;
    if (isPinned(task)) {
      top ??= lowestNonPinned(tasks);
      const position = between(null, top);
      top = position;
      moved = { ...un, position };
    }
    rows.set(task.id, moved);
    changed.push(task.id);
  }
  return { upserts: changed.reverse().map((id) => rows.get(id) as Task), removals: [] };
}

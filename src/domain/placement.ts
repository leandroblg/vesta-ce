/**
 * Where an item goes when it comes back to the active list: restore and undo of done/delete
 * (FR-024, FR-026, FR-036, FR-037; research.md §5).
 */
import { placePosition } from "./list-placement";
import { endPosition } from "./positions";
import { isActive, type ChangeSet, type Task } from "./task";
import { activeSiblings } from "./tree";

/**
 * Brings a done or deleted item back to the active list with the subtasks that went with it.
 * - after its former previous neighbour if active in the same list, else before its former next one, else at the end;
 * - a subtask whose parent is not active becomes top-level at the end;
 * - a collapsed active parent receiving a subtask is expanded.
 * Creation dates never change; collapse and renumbering never change last-edit times.
 */
export function bringBack(item: Task, tasks: readonly Task[], now: number, options: { expandParent?: boolean } = {}): ChangeSet {
  const upserts: Task[] = [];
  let parentId = item.parentId;
  let orphan = false;
  if (parentId !== null) {
    const parent = tasks.find((t) => t.id === parentId);
    if (parent === undefined || !isActive(parent) || parent.parentId !== null) {
      parentId = null;
      orphan = true;
    } else if (parent.collapsed) {
      upserts.push({ ...parent, collapsed: false });
    }
  }

  const siblings = activeSiblings(tasks, parentId).filter((s) => s.id !== item.id);
  let position: number;
  if (orphan) {
    position = endPosition(siblings.map((s) => s.position));
  } else {
    const placed = placePosition(item, siblings);
    position = placed.position;
    const renumbered = placed.renumbered;
    if (renumbered !== null) for (const s of siblings) upserts.push({ ...s, position: renumbered.get(s.id) ?? s.position });
  }

  const children = tasks
    .filter((t) => t.leftWithId === item.id && !isActive(t))
    .map((t) => ({ ...t, doneAt: null, deletedAt: null, leftWithId: null, updatedAt: now }));

  const back: Task = {
    ...item,
    // On restore, a collapsed parent bringing subtasks back comes back expanded, so a restore never hides
    // one (003 FR-028a); undo of a done or delete keeps it as it was.
    collapsed: options.expandParent === true && children.length > 0 ? false : item.collapsed,
    parentId,
    position,
    doneAt: null,
    deletedAt: null,
    prevSiblingId: null,
    nextSiblingId: null,
    leftWithId: null,
    updatedAt: now,
  };

  return { upserts: [back, ...children, ...upserts], removals: [] };
}

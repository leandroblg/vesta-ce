/**
 * The neighbour rule for any ordered list of items (tasks among their siblings, reminders):
 * remember neighbours when an item leaves, and put it back by them (001 FR-024, FR-036; 002 FR-013,
 * FR-017; research.md §3). Tasks and reminders call the same code so the rule cannot drift.
 */
import { MIN_GAP, endPosition, renumber } from "./positions";

export interface Placeable {
  id: string;
  position: number;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
}

/** The items just before and just after `id` in an ordered list (null at either end). */
export function neighboursOf(list: readonly Placeable[], id: string): { prevSiblingId: string | null; nextSiblingId: string | null } {
  const i = list.findIndex((x) => x.id === id);
  return { prevSiblingId: list[i - 1]?.id ?? null, nextSiblingId: list[i + 1]?.id ?? null };
}

/** Index in `siblings` (ordered, item excluded): after its former previous neighbour, else before its former next one, else the end. */
export function placeIndex(item: Placeable, siblings: readonly Placeable[]): number {
  const prev = siblings.findIndex((s) => s.id === item.prevSiblingId);
  if (prev >= 0) return prev + 1;
  const next = siblings.findIndex((s) => s.id === item.nextSiblingId);
  if (next >= 0) return next;
  return siblings.length;
}

export interface Placement {
  position: number;
  /** New positions for every sibling and the item, when the gap was too small; null otherwise. */
  renumbered: Map<string, number> | null;
}

/**
 * Positions for `ids` inserted, in that order, at `index` of `siblings` (ordered, the inserted items
 * removed): spread inside the gap, before the first or after the last. When the gap is under 1e-9 per
 * inserted item, the whole list is renumbered 1, 2, 3… in its final order (004 research §3; 001 research §4).
 */
export function positionAt(
  siblings: readonly Placeable[],
  index: number,
  ids: readonly string[],
): { positions: Map<string, number>; renumbered: Map<string, number> | null } {
  const before = siblings[index - 1]?.position ?? null;
  const after = siblings[index]?.position ?? null;
  const k = ids.length;
  if (before !== null && after !== null && after - before < MIN_GAP * k) {
    const order = [...siblings.slice(0, index).map((s) => s.id), ...ids, ...siblings.slice(index).map((s) => s.id)];
    const renumbered = renumber(order);
    return { positions: new Map(ids.map((id) => [id, renumbered.get(id) ?? 0])), renumbered };
  }
  let at: (i: number) => number;
  if (before !== null && after !== null) at = (i) => before + ((after - before) * (i + 1)) / (k + 1);
  else if (after !== null) at = (i) => after - k + i;
  else {
    const start = endPosition(siblings.map((s) => s.position));
    at = (i) => start + i;
  }
  return { positions: new Map(ids.map((id, i) => [id, at(i)])), renumbered: null };
}

/** The item's new position by the neighbour rule; renumbers the list when the midpoint gap is under 1e-9. */
export function placePosition(item: Placeable, siblings: readonly Placeable[]): Placement {
  const placed = positionAt(siblings, placeIndex(item, siblings), [item.id]);
  return { position: placed.positions.get(item.id) ?? 1, renumbered: placed.renumbered };
}

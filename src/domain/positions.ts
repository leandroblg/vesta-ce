/** Order among siblings is a REAL; inserts never rewrite other rows (research.md §4). */

export const MIN_GAP = 1e-9;

export function endPosition(positions: readonly number[]): number {
  return positions.length === 0 ? 1 : Math.max(...positions) + 1;
}

/** A position between two neighbours; either side may be open (null). */
export function between(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1;
  if (before === null) return (after as number) - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

export function needsRenumber(before: number | null, after: number | null): boolean {
  return before !== null && after !== null && after - before < MIN_GAP;
}

/** New positions 1, 2, 3… for ids already in their intended order. */
export function renumber(orderedIds: readonly string[]): Map<string, number> {
  return new Map(orderedIds.map((id, i) => [id, i + 1]));
}

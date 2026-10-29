/** Keyboard selection order (007 FR-025, FR-029, FR-031a): pure, over the cards in on-screen order. */

export interface CardRef {
  id: string;
  kind: "task" | "rem";
}

/** The card Select next / Select previous goes to; no wrap; nothing selected starts at an end. */
export function nextCard(order: readonly CardRef[], current: string | null, dir: "next" | "prev"): CardRef | null {
  if (order.length === 0) return null;
  const i = current === null ? -1 : order.findIndex((c) => c.id === current);
  if (i === -1) return (dir === "next" ? order[0] : order[order.length - 1]) ?? null;
  const j = dir === "next" ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
  return order[j] ?? null;
}

/**
 * Where the selection goes after `removed` (and the cards that left with it) is marked done, deleted,
 * restored or deleted permanently: the next card still shown, else the previous one, else the empty card.
 */
export function afterRemoval(orderBefore: readonly CardRef[], removedIds: ReadonlySet<string>, removed: string): CardRef | "emptyCard" {
  const i = orderBefore.findIndex((c) => c.id === removed);
  const after = orderBefore.slice(i + 1).find((c) => !removedIds.has(c.id));
  if (after !== undefined) return after;
  const before = orderBefore
    .slice(0, Math.max(0, i))
    .reverse()
    .find((c) => !removedIds.has(c.id));
  return before ?? "emptyCard";
}

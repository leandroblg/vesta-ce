/**
 * The log viewer's list rule (009 FR-014, FR-018; analysis M5): entries arrive on top while the user may be
 * scrolled down, so the scroll offset grows by the height of the rows added above, keeping the rows in view in
 * place. At the top, new rows simply show. Pure, so it is tested without a DOM.
 */

/** How many keys were added in front of `prevFirst`; 0 when the list was empty or replaced. */
export function addedOnTop(prevFirst: string | null, keys: readonly string[]): number {
  if (prevFirst === null) return 0;
  const i = keys.indexOf(prevFirst);
  return i === -1 ? 0 : i;
}

export function scrollAfterAddingOnTop(scrollTop: number, added: number, heights: readonly number[]): number {
  if (scrollTop <= 0 || added === 0) return scrollTop;
  let extra = 0;
  for (let i = 0; i < added; i++) extra += heights[i] ?? 0;
  return scrollTop + extra;
}

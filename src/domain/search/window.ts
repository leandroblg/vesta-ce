// Which rows a virtualized search list renders (006 SC-001, research §6): those intersecting the viewport,
// widened by an overscan, with spacer heights standing in for the rest.

export interface WindowInput {
  /** Each row's height in px (measured, or an estimate until measured). */
  heights: readonly number[];
  /** The list's top, in the scroll container's content coordinates. */
  listTop: number;
  scrollTop: number;
  viewport: number;
  overscan: number;
}

export interface RowWindow {
  /** First rendered row (inclusive) and last (exclusive). */
  start: number;
  end: number;
  /** Spacer heights above and below the rendered rows. */
  before: number;
  after: number;
}

export function visibleWindow({ heights, listTop, scrollTop, viewport, overscan }: WindowInput): RowWindow {
  const top = scrollTop - listTop - overscan;
  const bottom = scrollTop + viewport - listTop + overscan;
  let offset = 0;
  let start = heights.length;
  let end = heights.length;
  let before = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i] ?? 0;
    if (start === heights.length && offset + h > top) {
      start = i;
      before = offset;
    }
    if (offset >= bottom) {
      end = i;
      break;
    }
    offset += h;
  }
  if (start > end) start = end;
  if (start === heights.length) before = offset;
  let total = 0;
  for (const h of heights) total += h;
  let rendered = 0;
  for (let i = start; i < end; i++) rendered += heights[i] ?? 0;
  return { start, end, before, after: Math.max(0, total - before - rendered) };
}

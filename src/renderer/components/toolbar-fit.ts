/**
 * 014 FR-012 (PRD Q202): on a narrow window the toolbar gives way step by step instead of overlapping. Each level keeps
 * the ones before it: 1 the empty spaces shrink (the identity's 20 px margin, the 32 px right inset, the 8 px between
 * the Archive and Trash buttons), 2 the wordmark goes and the mark stays, 3 the mark goes, 4 the search box may shrink
 * under its minimum width. The level is measured, not set by breakpoints, because the labels' widths follow the
 * language and the counts.
 */
import { useLayoutEffect, type RefObject } from "react";

export const FIT_LEVELS = 4;
/** The toolbar's column gap: the least room between the search box and its neighbours. */
const GAP = 10;

/** True when the search box overlaps neither the identity nor the Archive and Trash buttons. */
function fits(bar: HTMLElement): boolean {
  const box = bar.querySelector<HTMLElement>(".search-box")?.getBoundingClientRect();
  const nav = bar.querySelector<HTMLElement>(".nav")?.getBoundingClientRect();
  if (box === undefined || nav === undefined) return true;
  const brand = bar.querySelector<HTMLElement>(".brand");
  const left = brand !== null && brand.offsetParent !== null ? brand.getBoundingClientRect().right : bar.getBoundingClientRect().left;
  return box.left >= left + GAP - 0.5 && box.right <= nav.left - GAP + 0.5;
}

/** Sets `data-fit` on the toolbar to the lowest level at which it fits, and returns it. */
export function fitToolbar(bar: HTMLElement): number {
  for (let level = 0; level < FIT_LEVELS; level++) {
    bar.dataset["fit"] = String(level);
    if (fits(bar)) return level;
  }
  bar.dataset["fit"] = String(FIT_LEVELS);
  return FIT_LEVELS;
}

/** Re-fits the toolbar whenever it or the Archive and Trash buttons change size. */
export function useToolbarFit(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (bar === null) return;
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitToolbar(bar));
    };
    fitToolbar(bar);
    const observer = new ResizeObserver(refit);
    observer.observe(bar);
    const nav = bar.querySelector(".nav");
    if (nav !== null) observer.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref]);
}

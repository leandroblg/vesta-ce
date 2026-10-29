/**
 * Windowed rows for the log viewer (009 research §6, analysis M5). Unlike 006's search hook it scrolls the
 * dialog's own list and keeps the rows in view in place when entries are added on top. It reuses the pure
 * `visibleWindow` helper; rows are measured once drawn.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, type RefObject } from "react";
import { visibleWindow } from "../../../domain/search/window";
import { addedOnTop, scrollAfterAddingOnTop } from "./log-rows";

const ESTIMATE_PX = 22;
const OVERSCAN_PX = 600;

export interface LogRows<T> {
  rows: T[];
  start: number;
  before: number;
  after: number;
}

/** `active`: the list is in the page (the dialog is open); the scroll listener attaches when it becomes true. */
export function useLogRows<T>(items: readonly T[], keyOf: (item: T) => string, scrollRef: RefObject<HTMLElement | null>, active: boolean): LogRows<T> {
  const heights = useRef(new Map<string, number>());
  const prevFirst = useRef<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!active || el === null) return undefined;
    let frame: number | null = null;
    const schedule = () => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          rerender();
        });
      }
    };
    el.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      el.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scrollRef, active]);

  // Rows added on top while scrolled down: move the offset by their height (FR-018).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const keys = items.map(keyOf);
    const added = addedOnTop(prevFirst.current, keys);
    prevFirst.current = keys[0] ?? null;
    if (el === null || added === 0) return;
    const sizes = keys.slice(0, added).map((k) => heights.current.get(k) ?? ESTIMATE_PX);
    el.scrollTop = scrollAfterAddingOnTop(el.scrollTop, added, sizes);
  }, [items, keyOf, scrollRef]);

  // Measure what was drawn; a changed height re-windows once.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    let changed = false;
    for (const row of el.querySelectorAll<HTMLElement>("li[data-key]")) {
      const key = row.dataset["key"] ?? "";
      const h = row.offsetHeight;
      if (h > 0 && heights.current.get(key) !== h) {
        heights.current.set(key, h);
        changed = true;
      }
    }
    if (changed) rerender();
  });

  const el = scrollRef.current;
  const sizes = items.map((item) => heights.current.get(keyOf(item)) ?? ESTIMATE_PX);
  if (el === null) {
    const first = Math.min(items.length, 60);
    let after = 0;
    for (let i = first; i < sizes.length; i++) after += sizes[i] ?? 0;
    return { rows: items.slice(0, first), start: 0, before: 0, after };
  }
  const w = visibleWindow({ heights: sizes, listTop: 0, scrollTop: el.scrollTop, viewport: el.clientHeight, overscan: OVERSCAN_PX });
  return { rows: items.slice(w.start, w.end), start: w.start, before: w.before, after: w.after };
}

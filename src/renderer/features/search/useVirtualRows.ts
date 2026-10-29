/**
 * Virtualized search lists (006 SC-001, research §6): while a search filters a list of more than
 * VIRTUAL_MIN rows, only the rows near the viewport are rendered, with spacers for the rest, so a keystroke
 * that matches nearly every item changes a few dozen rows instead of a thousand. Dragging is off during a
 * search (FR-011), so 004's layout snapshot, which needs every row, is never involved. Rows are measured
 * once rendered; keyboard focus near the window's edge scrolls the list so the next rows render.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, type RefObject } from "react";
import { visibleWindow } from "../../../domain/search/window";

/** Smaller result sets render in full, exactly as without virtualization. */
export const VIRTUAL_MIN = 100;
const OVERSCAN_PX = 600;
const ESTIMATE_PX = 46;

export interface VirtualRows<T> {
  virtual: boolean;
  rows: T[];
  /** Index of the first rendered row in `items` (for aria-posinset). */
  start: number;
  /** Total rows (for aria-setsize). */
  total: number;
  before: number;
  after: number;
}

function scrollParent(el: HTMLElement): HTMLElement {
  return el.closest<HTMLElement>(".main") ?? document.documentElement;
}

export function useVirtualRows<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  enabled: boolean,
  listRef: RefObject<HTMLUListElement | null>,
): VirtualRows<T> {
  const virtual = enabled && items.length > VIRTUAL_MIN;
  const heights = useRef(new Map<string, number>());
  /** The list position the last window was computed from; if layout moves the list, re-window. */
  const usedTop = useRef<number | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Re-window on scroll and resize, once per frame.
  useEffect(() => {
    const list = listRef.current;
    if (!virtual || list === null) return undefined;
    const container = scrollParent(list);
    let frame: number | null = null;
    const schedule = () => {
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null;
          rerender();
        });
      }
    };
    // Keyboard focus near the edge: bring it into view, which renders the rows beyond it.
    const onFocus = (e: FocusEvent) => {
      const row = (e.target as HTMLElement | null)?.closest("li");
      row?.scrollIntoView({ block: "nearest" });
    };
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    list.addEventListener("focusin", onFocus);
    return () => {
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      list.removeEventListener("focusin", onFocus);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [virtual, listRef]);

  // Measure the rendered rows; a changed height re-windows once.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!virtual || list === null) return;
    let changed = false;
    for (const el of list.querySelectorAll<HTMLElement>(":scope > li[data-id]")) {
      const key = el.dataset["id"] ?? "";
      const h = el.offsetHeight;
      if (h > 0 && heights.current.get(key) !== h) {
        heights.current.set(key, h);
        changed = true;
      }
    }
    // Sections above may have changed height in the same commit (for example the reminders being filtered).
    const container = scrollParent(list);
    const top = list.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    if (usedTop.current === null || Math.abs(top - usedTop.current) > 1) changed = true;
    if (changed) rerender();
  });

  if (!virtual) return { virtual: false, rows: [...items], start: 0, total: items.length, before: 0, after: 0 };
  const list = listRef.current;
  const sizes = items.map((item) => heights.current.get(keyOf(item)) ?? ESTIMATE_PX);
  if (list === null) {
    // First render: the top rows only, until the list is in the page and can be measured.
    const first = Math.min(items.length, 30);
    let after = 0;
    for (let i = first; i < sizes.length; i++) after += sizes[i] ?? 0;
    return { virtual: true, rows: items.slice(0, first), start: 0, total: items.length, before: 0, after };
  }
  // The list's flex gap sits between rows; count it as part of each row's height.
  const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
  const h = sizes.map((x) => x + gap);
  const container = scrollParent(list);
  const listTop = list.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  usedTop.current = listTop;
  const w = visibleWindow({ heights: h, listTop, scrollTop: container.scrollTop, viewport: container.clientHeight, overscan: OVERSCAN_PX });
  return { virtual: true, rows: items.slice(w.start, w.end), start: w.start, total: items.length, before: w.before, after: w.after };
}

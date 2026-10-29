/**
 * Placement and closing shared by the context menu and the Alert override panel, so the panel opens at the
 * menu's spot and both stay inside the window (001 FR-009, 003 FR-034).
 */
import { useEffect, useLayoutEffect, type RefObject } from "react";

const MARGIN = 8;
const GAP = 4;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Where a popover goes, always 8 px inside the window:
 * - `below-right`: below the anchor, right edges aligned, above it when there is no room below (the context menu
 *   and the Alert override panel; 015 FR-010c keeps it);
 * - `below-center`: below the anchor, centered under it, moved sideways only as far as the margins require (the
 *   hold row of quick durations, 015 FR-006, PRD Q222);
 * - `left-of-menu`: left of `menu`, vertically centered on the anchor item, on the menu's right only when the left
 *   has no room, so the menu never moves (the Postpone For row, 015 FR-010b, PRD Q220);
 * - `at-point`: its top-left corner at the anchor's (a point: the pointer of a right-click), above it when there is
 *   no room below (the link context menu, 016 FR-016).
 */
export type Placement = "below-right" | "below-center" | "left-of-menu" | "at-point";

export function place(
  placement: Placement,
  anchor: Rect,
  size: { width: number; height: number },
  view: { width: number; height: number },
  menu?: Rect,
): { left: number; top: number } {
  const clampX = (x: number) => Math.max(MARGIN, Math.min(x, view.width - size.width - MARGIN));
  const clampY = (y: number) => Math.max(MARGIN, Math.min(y, view.height - size.height - MARGIN));
  if (placement === "left-of-menu" && menu !== undefined) {
    const leftSide = menu.left - GAP - size.width;
    const left = leftSide >= MARGIN ? leftSide : clampX(menu.right + GAP);
    return { left, top: clampY(anchor.top + anchor.height / 2 - size.height / 2) };
  }
  if (placement === "at-point") {
    const top = anchor.top + size.height > view.height - MARGIN ? Math.max(MARGIN, anchor.top - size.height) : anchor.top;
    return { left: clampX(anchor.left), top };
  }
  const below = anchor.bottom + GAP;
  const top = below + size.height > view.height - MARGIN ? Math.max(MARGIN, anchor.top - size.height - GAP) : below;
  const left = placement === "below-center" ? anchor.left + anchor.width / 2 - size.width / 2 : anchor.right - size.width;
  return { left: clampX(left), top };
}

/** Places the popover with `place` (below the anchor, right-aligned, by default) when it first appears. */
export function useAnchoredPosition(
  ref: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onPlaced?: () => void,
  placement: Placement = "below-right",
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = anchorRef.current;
    if (el === null || anchor === null) return;
    const menu = placement === "left-of-menu" ? anchor.closest("[role='menu']")?.getBoundingClientRect() : undefined;
    const at = place(placement, anchor.getBoundingClientRect(), { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, menu);
    el.style.left = `${String(at.left)}px`;
    el.style.top = `${String(at.top)}px`;
    // A fixed popover inside an element with a filter or backdrop-filter (the context menu, for its Postpone For row)
    // is placed relative to that element, not the window: correct by where it actually landed.
    const landed = el.getBoundingClientRect();
    if (Math.abs(landed.left - at.left) > 0.5 || Math.abs(landed.top - at.top) > 0.5) {
      el.style.left = `${String(2 * at.left - landed.left)}px`;
      el.style.top = `${String(2 * at.top - landed.top)}px`;
    }
    // Runs once, when the popover first appears (onPlaced is deliberately not a dependency).
    onPlaced?.();
  }, [ref, anchorRef, placement]);
}

/** Calls onClose on a pointer press outside the popover and its anchor. */
export function useOutsidePointer(ref: RefObject<HTMLElement | null>, anchorRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (ref.current?.contains(target) === true || anchorRef.current?.contains(target) === true) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [ref, anchorRef, onClose]);
}

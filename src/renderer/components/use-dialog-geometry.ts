/**
 * 016 FR-036 to FR-039 (PRD Q236, Q239, Q242, Q244, Q246, Q254, Q258; research §11): the place and size of Settings and
 * the log viewer, shared. They follow the window (and, for Settings, the pane) until moved or resized by hand, then
 * keep that until the dialog closes; nothing is remembered after. A drag by the head moves the dialog, a drag on one
 * of the eight bands resizes it; with the focus on the head itself, the arrow keys move it and Shift+arrows resize it.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { dialogGeometry, floorSize, nudge, type Rect, type UserRect } from "../../domain/dialog-geometry";

/** The eight resize bands, by the edges each one moves (015 FR-027a). */
export const BANDS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

export interface DialogGeometryOptions {
  open: boolean;
  modal: RefObject<HTMLElement | null>;
  /** The share of the window it opens at: 0.6 for Settings, 0.8 for Logs. */
  share: number;
  /** The height follows `content` (Settings). */
  follow: boolean;
  /** The natural height of the dialog's content, measured on `modal`. */
  content?: (modal: HTMLElement) => number;
  /** What, inside `modal`, changes `content` when it changes size. */
  observe?: string;
  /** Controls inside a drag area that keep their own click (never start a move). */
  controls: string;
}

export interface DialogGeometry {
  rect: Rect;
  /** On the head (a move) and on each band (`data-edges`, a resize). */
  drag: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  };
  /** On the head: the arrow keys while the head itself has the focus (Q258). */
  onHeadKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  /** Whether a drag just ended (the click that follows is not a click on the backdrop); asking clears it. */
  takeDragged: () => boolean;
  /** The dialog closed: it opens at its own place and size again. */
  reset: () => void;
}

export function useDialogGeometry({ open, modal, share, follow, content: measureContent, observe, controls }: DialogGeometryOptions): DialogGeometry {
  const [win, setWin] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [content, setContent] = useState(0);
  const [user, setUser] = useState<UserRect | null>(null);
  const drag = useRef<{ px: number; py: number; from: Rect; edges: string | null } | null>(null);
  const dragged = useRef(false);
  const rect = dialogGeometry({ win, content, user, share, follow });
  const measureRef = useRef(measureContent);
  measureRef.current = measureContent;

  useEffect(() => {
    const m = modal.current;
    if (!open || m === null) return;
    const measure = () => {
      setWin({ w: window.innerWidth, h: window.innerHeight });
      if (measureRef.current !== undefined) setContent(measureRef.current(m));
    };
    measure();
    // A pane shown, a section growing or the window resized: each changes what the dialog needs.
    const observer = new ResizeObserver(measure);
    if (observe !== undefined) for (const el of m.querySelectorAll(observe)) observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, modal, observe]);

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    const edges = e.currentTarget.dataset.edges ?? null;
    if (e.button !== 0) return;
    if (edges === null && e.target instanceof Element && e.target.closest(controls) !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, from: rect, edges };
    dragged.current = false;
  }

  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (d === null) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (dx !== 0 || dy !== 0) dragged.current = true;
    const { from, edges } = d;
    if (edges === null) {
      setUser({ x: from.x + dx, y: from.y + dy, w: user?.w ?? null, h: user?.h ?? null });
      return;
    }
    const floor = floorSize(win);
    let w = from.w;
    let h = from.h;
    if (edges.includes("e")) w = from.w + dx;
    if (edges.includes("w")) w = from.w - dx;
    if (edges.includes("s")) h = from.h + dy;
    if (edges.includes("n")) h = from.h - dy;
    w = Math.max(floor.w, w);
    h = Math.max(floor.h, h);
    // The west and north edges move the dialog's origin; the opposite edge stays where it was.
    const x = edges.includes("w") ? from.x + from.w - w : from.x;
    const y = edges.includes("n") ? from.y + from.h - h : from.y;
    setUser({ x, y, w, h });
  }

  function onPointerUp(e: PointerEvent<HTMLElement>) {
    if (drag.current === null) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onHeadKeyDown(e: KeyboardEvent<HTMLElement>) {
    // Only the head itself: a tab, the level select or a button keeps its own arrow keys (Q258).
    if (e.target !== e.currentTarget || e.altKey || e.metaKey || e.ctrlKey) return;
    const next = nudge(rect, { key: e.key, shift: e.shiftKey }, win);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    // A move keeps the size following the pane, as a drag by the head does; a resize sets it.
    setUser(e.shiftKey ? next : { x: next.x, y: next.y, w: user?.w ?? null, h: user?.h ?? null });
  }

  return {
    rect,
    drag: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    onHeadKeyDown,
    takeDragged: () => {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
    reset: () => {
      setUser(null);
    },
  };
}

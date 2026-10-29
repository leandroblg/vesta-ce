/**
 * 016 a dialog's place and size within the window (research §11; FR-036 to FR-039, PRD Q236, Q239, Q243, Q244, Q246,
 * Q254, Q258), replacing 015's settingsGeometry, in CSS pixels.
 *
 * - Settings (`share` 0.6, `follow`): width 60 % on every pane; its top edge where 60 % puts it (20 % from the top),
 *   so the toolbar of panes never moves; its height follows the pane: the content, never below the floor, growing
 *   down until its bottom edge is 10 % of the window's height above the window's bottom (Q212), then scrolling.
 * - Logs (`share` 0.8, not `follow`): centered at 80 % of the window's width and height.
 * - The floor is 360 × 320 px and wins over the share and every margin, up to the whole window (Q244).
 * - Moved or resized by hand, it keeps that place or size, width and height, on every pane until it closes (Q246);
 *   when the window gets smaller it moves first, then shrinks, never below the floor (FR-039).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the user did since the dialog opened: a move sets `x`, `y`; a resize sets all four. */
export interface UserRect {
  x: number;
  y: number;
  w: number | null;
  h: number | null;
}

export interface GeometryInput {
  win: { w: number; h: number };
  /** The natural height of the dialog's content (Settings: the toolbar of panes, the title and the pane). */
  content: number;
  user: UserRect | null;
  /** The share of the window's width (and, without `follow`, height) the dialog opens at. */
  share: number;
  /** The height follows the content, the top edge staying where `share` puts it (Settings). */
  follow: boolean;
}

const BOTTOM = 0.9;
const MIN_W = 360;
const MIN_H = 320;
/** 016 FR-038 (PRD Q254): one arrow key press moves or resizes the dialog this much. */
export const NUDGE_PX = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** The floor: 360 × 320 px, or the whole window when that is smaller (Q244, replacing Q218's 16 px margin). */
export function floorSize(win: { w: number; h: number }): { w: number; h: number } {
  return { w: Math.min(MIN_W, win.w), h: Math.min(MIN_H, win.h) };
}

export function dialogGeometry({ win, content, user, share, follow }: GeometryInput): Rect {
  const floor = floorSize(win);
  if (user?.w != null && user.h != null) {
    // A size set by hand holds (Q246); a window that no longer fits it moves it first, then shrinks it.
    const w = clamp(user.w, floor.w, win.w);
    const h = clamp(user.h, floor.h, win.h);
    return { x: clamp(user.x, 0, win.w - w), y: clamp(user.y, 0, win.h - h), w, h };
  }
  const w = clamp(share * win.w, floor.w, win.w);
  const shareH = clamp(share * win.h, floor.h, win.h);
  // Settings: as tall as the content from `top`, down to the 10 % margin, never below the floor.
  const followed = (top: number) => clamp(content, floor.h, Math.max(floor.h, Math.min(BOTTOM * win.h, win.h) - top));
  if (user === null) {
    if (!follow) return { x: (win.w - w) / 2, y: (win.h - shareH) / 2, w, h: shareH };
    const top = ((1 - share) / 2) * win.h;
    const h = followed(top);
    return { x: (win.w - w) / 2, y: clamp(top, 0, win.h - h), w, h };
  }
  const x = clamp(user.x, 0, win.w - w);
  const y = clamp(user.y, 0, win.h - (follow ? floor.h : shareH));
  const h = follow ? Math.min(followed(y), win.h - y) : shareH;
  return { x, y, w, h };
}

/**
 * 016 FR-038 (PRD Q254, Q258): an arrow key on the focused head moves the dialog 10 px; with Shift it resizes it
 * 10 px from its bottom-right corner (Right and Down grow, Left and Up shrink). Null for any other key.
 */
export function nudge(rect: Rect, key: { key: string; shift: boolean }, win: { w: number; h: number }): Rect | null {
  const dx = key.key === "ArrowRight" ? NUDGE_PX : key.key === "ArrowLeft" ? -NUDGE_PX : 0;
  const dy = key.key === "ArrowDown" ? NUDGE_PX : key.key === "ArrowUp" ? -NUDGE_PX : 0;
  if (dx === 0 && dy === 0) return null;
  const floor = floorSize(win);
  if (key.shift) {
    const w = clamp(rect.w + dx, floor.w, Math.max(floor.w, win.w - rect.x));
    const h = clamp(rect.h + dy, floor.h, Math.max(floor.h, win.h - rect.y));
    return { x: rect.x, y: rect.y, w, h };
  }
  return { x: clamp(rect.x + dx, 0, win.w - rect.w), y: clamp(rect.y + dy, 0, win.h - rect.h), w: rect.w, h: rect.h };
}

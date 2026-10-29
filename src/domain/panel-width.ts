// The details panel's width (FR-005): 300 px to min(760 px, 70 % of the window), 420 px by default.
export const PANEL_MIN_PX = 300;
export const PANEL_MAX_PX = 760;
export const PANEL_DEFAULT_PX = 420;

/** Clamps to the stored range; `windowPx` adds the 70 % limit for the current window. */
export function clampPanelWidth(px: number, windowPx?: number): number {
  const max =
    windowPx === undefined ? PANEL_MAX_PX : Math.max(PANEL_MIN_PX, Math.min(PANEL_MAX_PX, Math.floor(windowPx * 0.7)));
  return Math.min(max, Math.max(PANEL_MIN_PX, Math.round(px)));
}

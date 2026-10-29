/**
 * Drawing span colors readable in the active theme (011 FR-009, PRD Q146, Q147; research §10). The stored colors
 * stay in `data-color` / `data-bg`; only the drawn colors change, set through the CSSOM (the CSP forbids style
 * attributes). Read-only markdown (render.ts) and the editor's spans both go through `paintSpan`.
 */
import { normalizeColor } from "../../domain/markdown/spans";
import { adaptFill, adaptForContrast, autoTextOn, composite } from "../../domain/markdown/contrast";
import { surfacesOf, type Theme } from "../../domain/theme-surfaces";
import type { PaletteSetting } from "../../domain/settings";
import { currentPalette, currentTheme } from "../theme";

export { currentTheme } from "../theme";

/** WCAG large text: at least 24 px, or 18.66 px bold (FR-009). Unknown size (a detached node) counts as normal. */
function minRatio(el: HTMLElement): 4.5 | 3 {
  if (!el.isConnected) return 4.5;
  const style = getComputedStyle(el);
  const px = parseFloat(style.fontSize);
  const bold = Number(style.fontWeight) >= 700 || style.fontWeight === "bold";
  return px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
}

/** Most spans share a few colors: the drawn pair is computed once per palette, theme, color, fill and threshold. */
const drawnCache = new Map<string, { color: string; bg: string }>();

function drawn(color: string | null, bg: string | null, theme: Theme, min: 4.5 | 3, palette: PaletteSetting): { color: string; bg: string } {
  const key = `${palette}|${theme}|${String(min)}|${color ?? ""}|${bg ?? ""}`;
  const hit = drawnCache.get(key);
  if (hit !== undefined) return hit;
  const surfaces = surfacesOf(theme, palette).surfaces;
  const fill = bg === null ? null : adaptFill(bg, surfaces);
  let text = "";
  if (color !== null) text = adaptForContrast(color, fill === null ? surfaces : surfaces.map((s) => composite(fill, s)), min);
  else if (fill !== null) text = autoTextOn(fill, theme, palette);
  const result = { color: text, bg: fill ?? "" };
  if (drawnCache.size > 4096) drawnCache.clear();
  drawnCache.set(key, result);
  return result;
}

function stored(el: HTMLElement): { color: string | null; bg: string | null } {
  return {
    color: el.dataset.color === undefined ? null : normalizeColor(el.dataset.color),
    bg: el.dataset.bg === undefined ? null : normalizeColor(el.dataset.bg),
  };
}

export function paintSpan(el: HTMLElement, theme: Theme = currentTheme(), palette: PaletteSetting = currentPalette()): void {
  const { color, bg } = stored(el);
  const d = drawn(color, bg, theme, color === null ? 4.5 : minRatio(el), palette);
  el.style.backgroundColor = d.bg;
  el.style.color = d.color;
}

/** Reads every span's size first, then writes, so the page's style is computed once, not once per span. */
export function paintAll(root: ParentNode, theme: Theme = currentTheme(), palette: PaletteSetting = currentPalette()): void {
  const spans = Array.from(root.querySelectorAll<HTMLElement>("[data-vesta-span]"));
  const plan = spans.map((el) => {
    const s = stored(el);
    return { el, ...s, min: s.color === null ? (4.5 as const) : minRatio(el) };
  });
  for (const p of plan) {
    const d = drawn(p.color, p.bg, theme, p.min, palette);
    p.el.style.backgroundColor = d.bg;
    p.el.style.color = d.color;
  }
}

/** Held for the app's life: a MediaQueryList nobody references can be collected with its listener. */
let darkQuery: MediaQueryList | null = null;

/** Repaints every visible span when the effective theme changes (FR-009). Installed once at start. */
export function watchThemeForPaint(): void {
  if (darkQuery !== null || typeof matchMedia !== "function") return;
  darkQuery = matchMedia("(prefers-color-scheme: dark)");
  darkQuery.addEventListener("change", () => {
    paintAll(document.body);
  });
}

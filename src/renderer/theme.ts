/**
 * The active palette and appearance as the page shows them (HIG identity). The store writes the palette
 * to `<html data-palette>` so tokens.css picks its block; the editor's modules read it from there, with no store
 * import. Main sets nativeTheme.themeSource from the Appearance setting, so the media query is the effective mode.
 */
import { DEFAULT_PALETTE, isPaletteSetting, type PaletteSetting } from "../domain/settings";
import type { Theme } from "../domain/theme-surfaces";

export function currentTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentPalette(): PaletteSetting {
  const v = typeof document === "undefined" ? undefined : document.documentElement.dataset["palette"];
  return isPaletteSetting(v) ? v : DEFAULT_PALETTE;
}

/** Applies the palette to the page; the caller repaints the colored spans afterwards (011 FR-009). */
export function applyPalette(palette: PaletteSetting): void {
  if (typeof document === "undefined") return;
  if (palette === DEFAULT_PALETTE) delete document.documentElement.dataset["palette"];
  else document.documentElement.dataset["palette"] = palette;
}

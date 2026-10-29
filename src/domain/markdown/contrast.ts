/**
 * Readable chosen colors (011 FR-009, SC-003, PRD Q146, Q147; research §10). A text color is drawn as chosen when
 * it meets WCAG AA against every surface of the theme; otherwise its OKLCH lightness moves, hue kept, to the
 * nearest value that does. A highlight fill is drawn as chosen when it is at least as visible as the default
 * highlight in the light theme (FILL_MIN against the surface); otherwise the same. Display-only: stored colors never
 * change. Pure TypeScript: no DOM.
 */
import type { Hex8 } from "./colors";
import { surfacesOf, type Theme } from "../theme-surfaces";
import { DEFAULT_PALETTE, type PaletteSetting } from "../settings";

type Rgb = [number, number, number];

function channels(hex: string): { rgb: Rgb; alpha: number } {
  const h = hex.slice(1);
  const at = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { rgb: [at(0) / 255, at(2) / 255, at(4) / 255], alpha: h.length >= 8 ? at(6) / 255 : 1 };
}

function toHex(rgb: Rgb): Hex8 {
  const byte = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb[0])}${byte(rgb[1])}${byte(rgb[2])}ff`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** WCAG relative luminance of the color's RGB (alpha ignored; composite first). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).rgb.map(toLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two opaque colors. */
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` (possibly translucent) drawn over the opaque `bg`. */
export function composite(fg: string, bg: string): Hex8 {
  const f = channels(fg);
  const b = channels(bg).rgb;
  return toHex(f.rgb.map((c, i) => c * f.alpha + (b[i] as number) * (1 - f.alpha)) as Rgb);
}

// OKLab / OKLCH (Björn Ottosson, MIT).
function toOklch(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

function fromOklch(L: number, C: number, h: number): { rgb: Rgb; inGamut: boolean } {
  const A = C * Math.cos((h * Math.PI) / 180);
  const B = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const lin: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const inGamut = lin.every((c) => c >= -1e-6 && c <= 1 + 1e-6);
  return { rgb: lin.map((c) => fromLinear(Math.min(1, Math.max(0, c)))) as Rgb, inGamut };
}

/** The OKLCH hue of a color, in degrees (0–360). */
export function hueOf(hex: string): number {
  const h = toOklch(channels(hex).rgb)[2];
  return h < 0 ? h + 360 : h;
}

/** The color at lightness `L` with the given hue and the largest chroma up to `C` that fits sRGB. */
function atLightness(L: number, C: number, h: number): Hex8 {
  if (fromOklch(L, C, h).inGamut) return toHex(fromOklch(L, C, h).rgb);
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fromOklch(L, mid, h).inGamut) lo = mid;
    else hi = mid;
  }
  return toHex(fromOklch(L, lo, h).rgb);
}

/** The nearest lightness, toward black (`darker`) or white, at which `passes` holds; the color itself if it does. */
function adapt(color: Hex8, passes: (hex: Hex8) => boolean, darker: boolean, base: Hex8): Hex8 {
  if (passes(color)) return color;
  const [L0, C, h] = toOklch(channels(composite(color, base)).rgb);
  const end = darker ? 0 : 1;
  if (!passes(atLightness(end, C, h))) return darker ? "#000000ff" : "#ffffffff";
  let near = L0;
  let far = end;
  for (let i = 0; i < 32; i++) {
    const mid = (near + far) / 2;
    if (passes(atLightness(mid, C, h))) far = mid;
    else near = mid;
  }
  // Rounding to bytes may land just short: step on until it passes.
  let L = far;
  let hex = atLightness(L, C, h);
  for (let i = 0; i < 200 && !passes(hex); i++) {
    L += darker ? -0.002 : 0.002;
    hex = atLightness(L, C, h);
  }
  return hex;
}

const isLight = (surfaces: readonly Hex8[]) => surfaces.reduce((sum, s) => sum + luminance(s), 0) / surfaces.length > 0.18;

/** The drawn text color: as chosen when it meets `min` against every surface; else its lightness adapted (FR-009). */
export function adaptForContrast(fg: Hex8, backgrounds: readonly Hex8[], min: 4.5 | 3): Hex8 {
  const passes = (hex: Hex8) => backgrounds.every((b) => ratio(composite(hex, b), b) >= min);
  return adapt(fg, passes, isLight(backgrounds), backgrounds[0] ?? "#ffffffff");
}

/**
 * The least contrast a highlight fill keeps: the default highlight's own contrast on the light surface (PRD Q147),
 * 1.249:1 on Hearth's marble (#ffe066 on #fbfaf7), rounded down.
 */
export const FILL_MIN = 1.24;

/**
 * The drawn highlight fill: as chosen when at least FILL_MIN against the theme's main surface (`--surface`, where
 * cards and the panel sit, the surface the default highlight's contrast is measured on); else adapted (PRD Q147).
 */
export function adaptFill(bg: Hex8, surfaces: readonly Hex8[], min = FILL_MIN): Hex8 {
  const main = surfaces[0] ?? "#ffffffff";
  const passes = (hex: Hex8) => ratio(composite(hex, main), main) >= min;
  return adapt(bg, passes, isLight(surfaces), main);
}

/**
 * Text with no color on a (drawn) highlight: the theme's text color, else the other theme's, else black or white,
 * the first that meets AA (one of black and white always reaches at least 4.58:1).
 */
export function autoTextOn(fill: Hex8, theme: Theme, palette: PaletteSetting = DEFAULT_PALETTE): Hex8 {
  const own = surfacesOf(theme, palette);
  const other = surfacesOf(theme === "light" ? "dark" : "light", palette);
  const surface = own.surfaces[0] ?? "#ffffffff";
  const drawn = composite(fill, surface);
  const candidates: Hex8[] = [own.fg, other.fg, "#000000ff", "#ffffffff"];
  const passing = candidates.find((c) => ratio(c, drawn) >= 4.5);
  if (passing !== undefined) return passing;
  return candidates.reduce((best, c) => (ratio(c, drawn) > ratio(best, drawn) ? c : best));
}

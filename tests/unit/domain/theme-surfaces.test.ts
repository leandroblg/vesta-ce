// 011 FR-009 (research §10), HIG identity: the domain's copy of the theme surfaces matches tokens.css,
// palette by palette and mode by mode.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTES } from "../../../src/domain/settings";
import { SURFACES } from "../../../src/domain/theme-surfaces";
import { composite, ratio } from "../../../src/domain/markdown/contrast";

const css = readFileSync(resolve(import.meta.dirname, "../../../src/renderer/styles/tokens.css"), "utf8");

/** Every `/* palette:<name> mode:<light|dark> *\/ selector { … }` block of tokens.css, by palette and mode. */
function blocks(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of css.matchAll(/\/\* palette:(\w+) mode:(\w+) \*\/[^{]*\{([^}]*)\}/g)) {
    const tokens = Object.fromEntries<string>([
      ...[...(m[3] as string).matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((t): [string, string] => [t[1] as string, `${(t[2] as string).toLowerCase()}ff`]),
      // 014 FR-006d: translucent tokens (--fg-3) as #rrggbbaa.
      ...[...(m[3] as string).matchAll(/(--[\w-]+):\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s*;/gi)].map((t): [string, string] => [
        t[1] as string,
        `#${[t[2], t[3], t[4]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}${Math.round(Number(t[5]) * 255)
          .toString(16)
          .padStart(2, "0")}`,
      ]),
    ]);
    out[`${m[1] as string}:${m[2] as string}`] = tokens;
  }
  return out;
}

const NAMES = ["--surface", "--bg", "--surface-2", "--stale-soft", "--accent-soft"];
const found = blocks();

describe("FR-009 theme surfaces mirror tokens.css", () => {
  it("tokens.css has a light and a dark block for every palette", () => {
    expect(Object.keys(found).sort()).toEqual(PALETTES.flatMap((p) => [`${p}:dark`, `${p}:light`]).sort());
  });

  it.each(PALETTES.flatMap((p) => (["light", "dark"] as const).map((m) => [p, m] as const)))("%s %s", (palette, theme) => {
    const values = found[`${palette}:${theme}`] ?? {};
    expect(SURFACES[palette][theme].surfaces).toEqual(NAMES.map((n) => values[n]));
    expect(SURFACES[palette][theme].fg).toBe(values["--fg"]);
  });
});

describe("013 FR-034 the selected card's fill (research §11, analysis K1)", () => {
  const pairs = PALETTES.flatMap((p) => (["light", "dark"] as const).map((m) => [p, m] as const));

  it.each(pairs)("%s %s: the fill and its text mirror --accent and --accent-fg", (palette, theme) => {
    const values = found[`${palette}:${theme}`] ?? {};
    expect(SURFACES[palette][theme].accent).toEqual({ fill: values["--accent"], fg: values["--accent-fg"] });
  });

  it.each(pairs)("SC-012 %s %s: text on the fill meets AA (4.5:1)", (palette, theme) => {
    const { fill, fg } = SURFACES[palette][theme].accent;
    expect(ratio(fg, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(pairs)("constitution V %s %s: the fill contrasts at least 3:1 with the list surface, so selection is not color alone", (palette, theme) => {
    const set = SURFACES[palette][theme];
    expect(ratio(set.accent.fill, set.surfaces[0] as string)).toBeGreaterThanOrEqual(3);
  });
});

const PAIRS = PALETTES.flatMap((p) => (["light", "dark"] as const).map((m) => [p, m] as const));

/** color-mix(in srgb, a, b p): the share p of b, per channel (opaque colors). */
function mix(a: string, b: string, p: number): string {
  const ch = (h: string, i: number) => Number.parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - p) + ch(b, i) * p).toString(16).padStart(2, "0")).join("")}ff`;
}

describe("014 FR-006d the card icon colors mirror tokens.css (research §3)", () => {
  it.each(PAIRS)("%s %s: icons and the age text mirror --muted, --stale, --stale-blink, --fg-3, --stale-fg", (palette, theme) => {
    const values = found[`${palette}:${theme}`] ?? {};
    expect(SURFACES[palette][theme].icons).toEqual({
      muted: values["--muted"],
      stale: values["--stale"],
      staleBlink: values["--stale-blink"],
      fg3: values["--fg-3"],
    });
    expect(SURFACES[palette][theme].text).toEqual({ staleFg: values["--stale-fg"] });
  });
});

describe("014 FR-006a every card icon reads at 3:1 on every card background (research §2, data-model.md)", () => {
  it.each(PAIRS)("%s %s", (palette, theme) => {
    const set = SURFACES[palette][theme];
    const [surface, , surface2, staleSoft] = set.surfaces as [string, string, string, string, string];
    const unselected = {
      rest: surface,
      hover: mix(surface, surface2, 0.6),
      stale: staleSoft,
      "stale hover": mix(staleSoft, surface2, 0.4),
      blink: set.icons.staleBlink,
      "button hover": surface2,
    };
    // Edit, menu, a reminder's Delete and the drag handle (--muted); Reschedule (--stale).
    for (const [name, bg] of Object.entries(unselected)) {
      expect(ratio(set.icons.muted, bg), `muted on ${name}`).toBeGreaterThanOrEqual(3);
      expect(ratio(set.icons.stale, bg), `stale on ${name}`).toBeGreaterThanOrEqual(3);
    }
    // A selected card: every icon in the accent's text color, on the fill and on its 18 % hover tint.
    const tint = composite(`${set.accent.fg.slice(0, 7)}2e`, set.accent.fill);
    expect(ratio(set.accent.fg, set.accent.fill), "accent-fg on the fill").toBeGreaterThanOrEqual(3);
    expect(ratio(set.accent.fg, tint), "accent-fg on the hover tint").toBeGreaterThanOrEqual(3);
  });

  it.each(PAIRS)("FR-006c %s %s: the old --fg-3 handle fails 3:1, so the handle uses --muted", (palette, theme) => {
    const set = SURFACES[palette][theme];
    const surface = set.surfaces[0] as string;
    expect(ratio(composite(set.icons.fg3, surface), surface)).toBeLessThan(3);
  });

  it.each(PAIRS)("SC-004a, FR-006e %s %s: a selected card's text in the blink's bright phase meets AA", (palette, theme) => {
    const set = SURFACES[palette][theme];
    expect(ratio(set.fg, set.icons.staleBlink), "fg on the blink").toBeGreaterThanOrEqual(4.5);
    expect(ratio(set.text.staleFg, set.icons.staleBlink), "stale-fg on the blink").toBeGreaterThanOrEqual(4.5);
  });
});

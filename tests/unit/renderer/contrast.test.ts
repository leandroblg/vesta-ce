/** Stale colours are theme tokens that keep WCAG AA text contrast in light and dark (003 FR-011, research §10). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../../../src/renderer/styles/tokens.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1] as string, (m[2] as string).toLowerCase()]));
}

const light = tokens(css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)")));
const dark = { ...light, ...tokens(css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("@media (prefers-reduced-motion"))) };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [fg: string, bg: string, use: string][] = [
  ["--fg", "--stale-soft", "title on a stale row"],
  ["--fg", "--stale-blink", "title during a blink"],
  ["--stale-fg", "--stale-soft", "age label and stale-subtask marker"],
  ["--faint", "--surface", "Archive stale tag"],
  ["--fg", "--search-hl", "006 search highlight"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_name, theme) => {
  it.each(PAIRS)("%s on %s (%s) meets 4.5:1", (fg, bg) => {
    const f = theme[fg];
    const b = theme[bg];
    expect(f, `${fg} is defined`).toBeDefined();
    expect(b, `${bg} is defined`).toBeDefined();
    expect(ratio(f as string, b as string)).toBeGreaterThanOrEqual(4.5);
  });
});

/** 007 research §14: Settings text (1.4.3, 4.5:1) and the controls and focus ring (1.4.11, 3:1). */
const TEXT_007: [fg: string, bg: string, use: string][] = [
  ["--muted", "--surface", "help text, an empty shortcut ('None')"],
  ["--stale-fg", "--surface", "field error text"],
  ["--accent", "--accent-soft", "the checked theme option, 'Press keys…'"],
  ["--fg", "--accent-soft", "the capturing row and its note"],
  ["--fg", "--surface-2", "kbd chips"],
  ["--fg", "--surface", "the shortcut status line"],
];

const NON_TEXT_007: [fg: string, bg: string, use: string][] = [
  ["--muted", "--surface", "field, select and radio-group borders, kbd borders"],
  ["--accent", "--bg", "the focus ring around a card (it sits 2 px outside the card)"],
  ["--accent", "--surface", "the focus ring inside Settings and on a hovered card"],
  ["--accent", "--surface-2", "the focus ring next to a hovered control"],
  ["--accent", "--stale-soft", "the focus ring next to a stale card"],
  ["--accent", "--search-hl", "the focus ring next to a search highlight"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("007 %s theme", (_name, theme) => {
  it.each(TEXT_007)("%s on %s (%s) meets 4.5:1", (fg, bg) => {
    expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT_007)("%s against %s (%s) meets 3:1", (fg, bg) => {
    expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(3);
  });
});

/** 009: the log viewer's text on its background, and the cogwheel's update mark (FR-016, FR-024; constitution V). */
const TEXT_009: [fg: string, bg: string, use: string][] = [
  ["--fg", "--bg", "log entries"],
  ["--stale-fg", "--bg", "Fatal and Error level names"],
  ["--muted", "--bg", "entry times, unreadable and shortened lines"],
];
const NON_TEXT_009: [fg: string, bg: string, use: string][] = [
  ["--accent", "--surface", "the cogwheel's update mark on the header"],
  ["--accent", "--bg", "the focus ring inside the log list"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("009 %s theme", (_name, theme) => {
  it.each(TEXT_009)("%s on %s (%s) meets 4.5:1", (fg, bg) => {
    expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT_009)("%s against %s (%s) meets 3:1", (fg, bg) => {
    expect(ratio(theme[fg] as string, theme[bg] as string)).toBeGreaterThanOrEqual(3);
  });
});

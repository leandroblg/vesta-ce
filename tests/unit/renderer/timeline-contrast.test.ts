/**
 * 016 FR-010, SC-003 (PRD Q226, Q250; research §3): the history timeline's hairline and dots keep 3:1 against the
 * panel surface (WCAG 1.4.11) in every color theme, light and dark. Ember is `--stale`, gold is `--flame` mixed 70 %
 * with `--fg` (as `color-mix(in srgb, …)` does), grey and the hairline are `--muted`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../../../src/renderer/styles/tokens.css"), "utf8");
const details = readFileSync(resolve(import.meta.dirname, "../../../src/renderer/styles/details.css"), "utf8");

/** Each `/* palette:X mode:Y *\/` block's hex tokens. */
function blocks(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const marks = [...css.matchAll(/\/\* palette:(\w+) mode:(\w+) \*\//g)];
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.index ?? css.length;
    const body = css.slice(m.index, end);
    const tokens = Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((t) => [t[1] as string, (t[2] as string).toLowerCase()]));
    out.set(`${m[1] as string} ${m[2] as string}`, tokens);
  });
  return out;
}

const rgb = (hex: string) => [0, 1, 2].map((i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16));
const hexOf = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, share: number) => hexOf(rgb(a).map((v, i) => v * share + (rgb(b)[i] as number) * (1 - share)));

function luminance(hex: string): number {
  const ch = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe("016 the history timeline's colors (FR-010)", () => {
  const all = blocks();
  it("covers the four color themes in light and dark", () => {
    expect([...all.keys()].sort()).toEqual(
      ["hearth dark", "hearth light", "minimal dark", "minimal light", "system dark", "system light", "ubuntu dark", "ubuntu light"].sort(),
    );
  });

  it.each([...all.entries()])("%s: hairline and every dot reach 3:1 on the panel surface", (_name, t) => {
    const surface = t["--surface"] as string;
    const colors = {
      ember: t["--stale"] as string,
      gold: mix(t["--flame"] as string, t["--fg"] as string, 0.7),
      grey: t["--muted"] as string,
      hairline: t["--muted"] as string,
    };
    for (const [use, color] of Object.entries(colors)) expect(ratio(color, surface), use).toBeGreaterThanOrEqual(3);
  });

  it("details.css draws the timeline with those tokens", () => {
    expect(details).toMatch(/\.timeline[^{]*\{[^}]*--tl-line:\s*var\(--muted\)/);
    expect(details).toMatch(/data-kind="stale"\][^{]*\{[^}]*var\(--stale\)/);
    expect(details).toMatch(/data-kind="rescheduled"\][^{]*\{[^}]*color-mix\(in srgb, var\(--flame\) 70%, var\(--fg\)\)/);
  });
});

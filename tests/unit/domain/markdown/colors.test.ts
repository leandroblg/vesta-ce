import { describe, expect, it } from "vitest";
import {
  type Hex8,
  PRESET_COLORS,
  applied,
  pinAt,
  cleanRecent,
  isPreset,
  mergePinned,
  movePinned,
  pin,
  rewriteColors,
  sameColor,
  stampPinned,
  unpin,
  type ColorLists,
} from "../../../../src/domain/markdown/colors";

const NEUTRALS = ["#ffffff", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#000000"];
const HUES = ["red", "orange", "amber", "lime", "green", "teal", "sky", "blue", "violet", "pink"];
// Tailwind CSS v3.4 default palette (MIT), shades 100 to 900 per hue (data-model "Preset palette").
const SHADES: Record<string, string[]> = {
  red: ["#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"],
  orange: ["#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12"],
  amber: ["#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f"],
  lime: ["#ecfccb", "#d9f99d", "#bef264", "#a3e635", "#84cc16", "#65a30d", "#4d7c0f", "#3f6212", "#365314"],
  green: ["#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d"],
  teal: ["#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a"],
  sky: ["#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e"],
  blue: ["#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"],
  violet: ["#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95"],
  pink: ["#fce7f3", "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#be185d", "#9d174d", "#831843"],
};

const lists = (pinned: string[], recent: string[]): ColorLists => ({ pinned, recent });
const custom = (n: number) => `#0${n.toString(16).padStart(5, "0")}ff`;

describe("FR-010 the preset palette", () => {
  it("FR-010 the preset has 100 colors in grid order", () => {
    expect(PRESET_COLORS).toHaveLength(100);
    expect(PRESET_COLORS.slice(0, 10).map((c) => c.hex)).toEqual(NEUTRALS.map((h) => `${h}ff`));
    expect(PRESET_COLORS.slice(0, 10).map((c) => c.shade)).toEqual(["white", 100, 200, 300, 400, 500, 600, 700, 800, "black"]);
    for (let row = 1; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const c = PRESET_COLORS[row * 10 + col];
        const hue = HUES[col] as string;
        expect(c).toEqual({ hex: `${(SHADES[hue] as string[])[row - 1] as string}ff`, hue, shade: row * 100 });
      }
    }
    expect(new Set(PRESET_COLORS.map((c) => c.hex)).size).toBe(100);
  });

  it("isPreset and sameColor compare stored forms", () => {
    expect(isPreset("#ef4444ff")).toBe(true);
    expect(isPreset("#EF4444")).toBe(true);
    expect(isPreset("#ef444480")).toBe(false);
    expect(sameColor("#d33", "#dd3333ff")).toBe(true);
    expect(sameColor("#336699", "#33669980")).toBe(false);
  });
});

describe("FR-012 recent colors", () => {
  it("FR-012 a color applied from the recent rows moves first", () => {
    const l = lists([], ["#000001ff", "#000002ff"]);
    expect(applied(l, "#000002ff", "recent")).toEqual(lists([], ["#000002ff", "#000001ff"]));
  });

  it("FR-012 a custom color is added first unless preset or pinned", () => {
    const l = lists(["#123456ff"], ["#000001ff"]);
    expect(applied(l, "#000002ff", "custom").recent).toEqual(["#000002ff", "#000001ff"]);
    expect(applied(l, "#ef4444ff", "custom")).toBe(l);
    expect(applied(l, "#123456ff", "custom")).toBe(l);
  });

  it("FR-012 a preset or pinned color applied leaves the lists unchanged (same object)", () => {
    const l = lists(["#123456ff"], ["#000001ff"]);
    expect(applied(l, "#ef4444ff", "preset")).toBe(l);
    expect(applied(l, "#123456ff", "pinned")).toBe(l);
    expect(applied(lists([], ["#000001ff"]), "#000001ff", "recent").recent).toEqual(["#000001ff"]);
  });

  it("FR-016 applying the color already first changes nothing", () => {
    const l = lists([], ["#000001ff", "#000002ff"]);
    expect(applied(l, "#000001ff", "recent")).toBe(l);
    expect(applied(l, "#000001ff", "custom")).toBe(l);
  });

  it("FR-012 21 custom colors keep the newest 20, newest first", () => {
    let l = lists([], []);
    for (let i = 0; i < 21; i++) l = applied(l, custom(i), "custom");
    expect(l.recent).toHaveLength(20);
    expect(l.recent[0]).toBe(custom(20));
    expect(l.recent).not.toContain(custom(0));
  });
});

describe("FR-011 pinned colors", () => {
  it("FR-011 a pin goes first and leaves the recent list", () => {
    const l = lists(["#000001ff"], ["#000002ff", "#000003ff"]);
    expect(pin(l, "#000003ff")).toEqual(lists(["#000003ff", "#000001ff"], ["#000002ff"]));
  });

  it("FR-011 pinning an already pinned color moves it first instead of adding it twice", () => {
    const l = lists(["#000001ff", "#000002ff"], []);
    expect(pin(l, "#000002ff")).toEqual(lists(["#000002ff", "#000001ff"], []));
    expect(pin(l, "#000001ff")).toBe(l);
  });

  it("FR-011 a twelfth pin drops the last, which is not added to recent", () => {
    let l = lists([], []);
    for (let i = 0; i < 11; i++) l = pin(l, custom(i));
    expect(l.pinned).toHaveLength(10);
    expect(l.pinned[0]).toBe(custom(10));
    expect(l.pinned).not.toContain(custom(0));
    expect(l.recent).toEqual([]);
  });

  it("FR-011 unpin removes the color and does not add it to recent", () => {
    const l = lists(["#000001ff", "#000002ff"], []);
    expect(unpin(l, "#000001ff")).toEqual(lists(["#000002ff"], []));
    expect(unpin(l, "#000009ff")).toBe(l);
  });

  it("FR-011 movePinned reorders and keeps the others' order", () => {
    const l = lists(["#000001ff", "#000002ff", "#000003ff"], []);
    expect(movePinned(l, 0, 2).pinned).toEqual(["#000002ff", "#000003ff", "#000001ff"]);
    expect(movePinned(l, 2, 0).pinned).toEqual(["#000003ff", "#000001ff", "#000002ff"]);
    expect(movePinned(l, 1, 1)).toBe(l);
  });
});

describe("FR-011 FR-017 pin times, merge and clean (PRD Q145)", () => {
  it("FR-011 stampPinned keeps unmoved times and renews new and re-pinned colors", () => {
    const prev = [
      { hex: "#000001ff", at: 10 },
      { hex: "#000002ff", at: 20 },
    ];
    expect(stampPinned(prev, ["#000002ff", "#000001ff"], 99)).toEqual([
      { hex: "#000002ff", at: 20 },
      { hex: "#000001ff", at: 10 },
    ]);
    expect(stampPinned(prev, ["#000003ff", "#000001ff", "#000002ff"], 99, "#000003ff")).toEqual([
      { hex: "#000003ff", at: 99 },
      { hex: "#000001ff", at: 10 },
      { hex: "#000002ff", at: 20 },
    ]);
    expect(stampPinned(prev, ["#000002ff", "#000001ff"], 99, "#000002ff")[0]).toEqual({ hex: "#000002ff", at: 99 });
  });

  it("FR-017 pinned colors merge color by color", () => {
    const local = [
      { hex: "#00000aff", at: 1 },
      { hex: "#00000bff", at: 5 },
    ];
    const imported = [
      { hex: "#00000bff", at: 3 },
      { hex: "#00000cff", at: 4 },
    ];
    expect(mergePinned(local, imported)).toEqual([
      { hex: "#00000bff", at: 5 },
      { hex: "#00000cff", at: 4 },
      { hex: "#00000aff", at: 1 },
    ]);
  });

  it("FR-017 twelve distinct pinned colors keep the newest 10 by pin time", () => {
    const local = Array.from({ length: 6 }, (_, i) => ({ hex: custom(i), at: i }));
    const imported = Array.from({ length: 6 }, (_, i) => ({ hex: custom(i + 6), at: i + 6 }));
    const merged = mergePinned(local, imported);
    expect(merged).toHaveLength(10);
    expect(merged[0]).toEqual({ hex: custom(11), at: 11 });
    expect(merged.map((e) => e.hex)).not.toContain(custom(0));
    expect(merged.map((e) => e.hex)).not.toContain(custom(1));
  });

  it("FR-012 cleanRecent drops pinned and preset colors", () => {
    expect(cleanRecent(["#000001ff", "#ef4444ff", "#000002ff"], ["#000002ff"])).toEqual(["#000001ff"]);
  });
});

describe("FR-015 rewriteColors (US2-14, research §13)", () => {
  it.each([
    ['[t]{color="#d33"}', '[t]{color="#dd3333ff"}'],
    ['[t]{bg="#FFE066"}', '[t]{bg="#ffe066ff"}'],
    ['[t]{color="#d33" bg="#ffe066" .underline}', '[t]{color="#dd3333ff" bg="#ffe066ff" .underline}'],
    ['[t]{.underline size="2em" bg="#ffe066" color="#d33"}', '[t]{.underline size="2em" bg="#ffe066ff" color="#dd3333ff"}'],
    ['[t]{color=#d33}', '[t]{color="#dd3333ff"}'],
    ['[**b** [in]{bg="#abc"}]{color="#d33"}', '[**b** [in]{bg="#aabbccff"}]{color="#dd3333ff"}'],
  ])("FR-015 %s → %s", (input, output) => {
    expect(rewriteColors(input)).toBe(output);
  });

  it("FR-015 keeps an 8-digit color and returns the same string when nothing changes", () => {
    const md = '[t]{bg="#ffe06680"} and [u]{.underline}';
    expect(rewriteColors(md)).toBe(md);
  });

  it("FR-015 never touches code or text that only looks like a span", () => {
    const md = [
      "# Heading",
      "",
      'Inline `]{color="#d33"}` code and \\[x]{color="#d33"} escaped.',
      "",
      "```",
      '[x]{color="#d33"}',
      "```",
      "",
      "| a | b |",
      "| - | - |",
      '| [c]{color="#d33"} | *e* |',
      "",
      "- item with **bold** and [s]{bg=\"#ffe066\"}",
    ].join("\n");
    const out = rewriteColors(md);
    expect(out).toBe(md.replace('| [c]{color="#d33"} |', '| [c]{color="#dd3333ff"} |').replace('[s]{bg="#ffe066"}', '[s]{bg="#ffe066ff"}'));
  });

  it("FR-015 a repeated or invalid color is left as written", () => {
    expect(rewriteColors('[t]{color="#d33" color="#abc"}')).toBe('[t]{color="#dd3333ff" color="#abc"}');
    expect(rewriteColors('[t]{color="red"}')).toBe('[t]{color="red"}');
  });
});

describe("016 FR-028 to FR-030 pinning at a position (PRD Q223)", () => {
  const h = (n: number) => `#0000${n.toString(16).padStart(2, "0")}ff`;
  const lists = (pinned: Hex8[], recent: Hex8[]) => ({ pinned, recent });
  it("inserts at the drop position and leaves the recent colors", () => {
    const l = lists([h(1), h(2), h(3)], [h(9), h(8)]);
    expect(pinAt(l, h(9), 2)).toEqual(lists([h(1), h(2), h(9), h(3)], [h(8)]));
    expect(pinAt(l, h(9), 0)).toEqual(lists([h(9), h(1), h(2), h(3)], [h(8)]));
  });
  it("past the end, or on an empty row, pins last", () => {
    expect(pinAt(lists([h(1)], [h(9)]), h(9), 7)).toEqual(lists([h(1), h(9)], []));
    expect(pinAt(lists([], [h(9)]), h(9), 0)).toEqual(lists([h(9)], []));
  });
  it("with ten pinned, the rightmost is dropped", () => {
    const ten = Array.from({ length: 10 }, (_, i) => h(i + 1));
    const r = pinAt(lists(ten, [h(99)]), h(99), 3);
    expect(r.pinned).toHaveLength(10);
    expect(r.pinned[3]).toBe(h(99));
    expect(r.pinned).not.toContain(h(10));
  });
  it("a color already pinned moves to the position instead of being added twice", () => {
    const l = lists([h(1), h(2), h(3), h(4)], []);
    expect(pinAt(l, h(1), 3).pinned).toEqual([h(2), h(3), h(1), h(4)]);
    expect(pinAt(l, h(4), 1).pinned).toEqual([h(1), h(4), h(2), h(3)]);
  });
  it("returns the same object when nothing changes, and pin is pinAt at 0", () => {
    const l = lists([h(1), h(2)], []);
    expect(pinAt(l, h(1), 0)).toBe(l);
    expect(pin(lists([h(1)], [h(2)]), h(2))).toEqual(pinAt(lists([h(1)], [h(2)]), h(2), 0));
  });
});

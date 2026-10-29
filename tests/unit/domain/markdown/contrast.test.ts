// 011 FR-009, SC-003 (research §10, PRD Q146, Q147): chosen colors are drawn readable in both themes.
import { describe, expect, it } from "vitest";
import {
  FILL_MIN,
  adaptFill,
  adaptForContrast,
  autoTextOn,
  composite,
  hueOf,
  ratio,
  luminance,
} from "../../../../src/domain/markdown/contrast";
import { PRESET_COLORS } from "../../../../src/domain/markdown/colors";
import { SURFACES } from "../../../../src/domain/theme-surfaces";

// The default palette (Hearth); every palette's surfaces are checked by theme-surfaces.test.ts.
const light = SURFACES.hearth.light.surfaces;
const dark = SURFACES.hearth.dark.surfaces;
const minOver = (fg: string, bgs: readonly string[]) => Math.min(...bgs.map((b) => ratio(composite(fg, b), b)));
/** Fills are judged against the theme's main surface, where the default highlight measures FILL_MIN. */
const fillMin = (bg: string, bgs: readonly string[]) => ratio(composite(bg, bgs[0] as string), bgs[0] as string);

describe("FR-009 WCAG arithmetic", () => {
  it("luminance and ratio on known pairs", () => {
    expect(luminance("#ffffffff")).toBeCloseTo(1, 5);
    expect(luminance("#000000ff")).toBeCloseTo(0, 5);
    expect(ratio("#000000ff", "#ffffffff")).toBeCloseTo(21, 5);
    expect(ratio("#767676ff", "#ffffffff")).toBeCloseTo(4.54, 2);
  });

  it("composite of a translucent color over white", () => {
    expect(composite("#00000080", "#ffffffff")).toBe("#7f7f7fff");
    expect(composite("#336699ff", "#000000ff")).toBe("#336699ff");
  });
});

describe("FR-009 adaptive lightness for text", () => {
  const gray100 = "#f3f4f6ff";
  const gray800 = "#1f2937ff";

  it("FR-009 gray 800 on the light surfaces is drawn as chosen; gray 100 is drawn darker until it meets AA", () => {
    expect(adaptForContrast(gray800, light, 4.5)).toBe(gray800);
    const drawn = adaptForContrast(gray100, light, 4.5);
    expect(drawn).not.toBe(gray100);
    expect(minOver(drawn, light)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(drawn)).toBeLessThan(luminance(gray100));
  });

  it("FR-009 gray 100 on the dark surfaces is drawn as chosen; gray 800 is drawn lighter", () => {
    expect(adaptForContrast(gray100, dark, 4.5)).toBe(gray100);
    const drawn = adaptForContrast(gray800, dark, 4.5);
    expect(minOver(drawn, dark)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(drawn)).toBeGreaterThan(luminance(gray800));
  });

  it("FR-009 the hue is kept (±1°) and the result is deterministic", () => {
    const yellow = "#fcd34dff"; // amber 300
    const drawn = adaptForContrast(yellow, light, 4.5);
    expect(Math.abs(hueOf(drawn) - hueOf(yellow))).toBeLessThanOrEqual(1);
    expect(adaptForContrast(yellow, light, 4.5)).toBe(drawn);
  });

  it("FR-009 large text uses 3:1", () => {
    const c = "#9ca3afff"; // gray 400 on white is about 2.5:1
    const large = adaptForContrast(c, light, 3);
    expect(minOver(large, light)).toBeGreaterThanOrEqual(3);
    expect(minOver(large, light)).toBeLessThan(4.5);
  });

  it("SC-003 all 100 presets pass on every surface of both themes after adaptation, and those that already passed are unchanged", () => {
    for (const { hex } of PRESET_COLORS) {
      for (const surfaces of [light, dark]) {
        const drawn = adaptForContrast(hex, surfaces, 4.5);
        expect(minOver(drawn, surfaces), hex).toBeGreaterThanOrEqual(4.5);
        if (minOver(hex, surfaces) >= 4.5) expect(drawn, hex).toBe(hex);
      }
    }
  });
});

describe("FR-009 Automatic text on a highlight", () => {
  it("FR-009 every preset as a fill, in both themes, gets Automatic text that meets 4.5:1 (black or white when neither theme color does)", () => {
    for (const { hex } of PRESET_COLORS) {
      for (const theme of ["light", "dark"] as const) {
        const surface = SURFACES.hearth[theme].surfaces[0] as string;
        const fill = composite(adaptFill(hex, SURFACES.hearth[theme].surfaces), surface);
        expect(ratio(autoTextOn(adaptFill(hex, SURFACES.hearth[theme].surfaces), theme), fill), `${hex} ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(autoTextOn("#6b7280ff", "light")).toBe("#ffffffff");
  });

  it.each([
    ["#1e3a8aff", "light"],
    ["#1e3a8aff", "dark"],
    ["#fef3c7ff", "light"],
    ["#fef3c7ff", "dark"],
  ] as const)("FR-009 Automatic text on %s in %s meets 4.5:1", (fill, theme) => {
    const surface = SURFACES.hearth[theme].surfaces[0] as string;
    const drawnFill = adaptFill(fill, SURFACES.hearth[theme].surfaces);
    const text = autoTextOn(drawnFill, theme);
    expect(ratio(text, composite(drawnFill, surface))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("FR-009 highlight fills reach the default highlight's contrast (PRD Q147)", () => {
  const amber100 = "#fef3c7ff";
  const gray800 = "#1f2937ff";

  it("FR-009 the default highlight is unchanged in light (the threshold is its own contrast, PRD Q147)", () => {
    expect(adaptFill("#ffe066ff", light)).toBe("#ffe066ff");
    expect(fillMin("#ffe066ff", light)).toBeGreaterThanOrEqual(FILL_MIN);
  });

  it("FR-009 yellow 100 is drawn darker in light; gray 800 lighter in dark; each unchanged in the other theme", () => {
    const y = adaptFill(amber100, light);
    expect(luminance(y)).toBeLessThan(luminance(amber100));
    expect(fillMin(y, light)).toBeGreaterThanOrEqual(FILL_MIN);
    // Pastels sit close to white, where rounding to 8-bit channels moves the hue by about 1°.
    expect(Math.abs(hueOf(y) - hueOf(amber100))).toBeLessThanOrEqual(2);
    expect(adaptFill(amber100, dark)).toBe(amber100);
    const g = adaptFill(gray800, dark);
    expect(luminance(g)).toBeGreaterThan(luminance(gray800));
    expect(fillMin(g, dark)).toBeGreaterThanOrEqual(FILL_MIN);
    expect(adaptFill(gray800, light)).toBe(gray800);
  });

  it("SC-003 all 100 presets as fills reach FILL_MIN on the main surface of both themes, unchanged when they already did", () => {
    for (const { hex } of PRESET_COLORS) {
      for (const surfaces of [light, dark]) {
        const drawn = adaptFill(hex, surfaces);
        expect(fillMin(drawn, surfaces), hex).toBeGreaterThanOrEqual(FILL_MIN);
        if (fillMin(hex, surfaces) >= FILL_MIN) expect(drawn, hex).toBe(hex);
      }
    }
  });
});

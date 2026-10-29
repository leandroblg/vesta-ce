// 012 US4: the font size ladder (data-model "Font size ladder", FR-015 to FR-017, PRD Q156), with no document.
import { describe, expect, it } from "vitest";
import { SIZE_LADDER, canStep, stepSize } from "../../../../src/domain/editing/font-size";

describe("012 FR-015 the ladder", () => {
  it("FR-015 seven steps around the default", () => {
    expect(SIZE_LADDER).toEqual([0.75, 0.875, 1, 1.25, 1.5, 2, 2.5]);
  });

  const rows: [string | null, string | null, string | null][] = [
    // size, Increase, Decrease
    ["0.75em", "0.875em", null],
    ["0.875em", null, "0.75em"],
    [null, "1.25em", "0.875em"],
    ["1.25em", "1.5em", null],
    ["1.5em", "2em", "1.25em"],
    ["2em", "2.5em", "1.5em"],
  ];
  it.each(rows)("FR-016 %s steps up to %s and down to %s (null is the default, never stored)", (size, up, down) => {
    expect(stepSize(size, 1)).toBe(up);
    if (size !== "0.75em") expect(stepSize(size, -1)).toBe(down);
  });

  it("FR-016 2.5em only goes down; 0.75em only goes up", () => {
    expect(stepSize("2.5em", -1)).toBe("2em");
    expect(stepSize("0.75em", 1)).toBe("0.875em");
  });

  it("FR-016 a size off the ladder moves to the nearest step strictly above or below", () => {
    expect(stepSize("1.4em", 1)).toBe("1.5em");
    expect(stepSize("1.4em", -1)).toBe("1.25em");
    expect(stepSize("3em", -1)).toBe("2.5em");
    expect(stepSize("0.5em", 1)).toBe("0.75em");
    expect(stepSize("1em", 1)).toBe("1.25em");
  });

  it("FR-016 a size in another unit counts as the default", () => {
    expect(stepSize("12px", 1)).toBe("1.25em");
    expect(stepSize("150%", -1)).toBe("0.875em");
    expect(stepSize("1.2rem", 1)).toBe("1.25em");
  });

  it("FR-015 written values are exactly the ladder's", () => {
    const written = new Set<string | null>();
    let s: string | null = "0.75em";
    for (let i = 0; i < 8; i++) {
      written.add(s);
      s = stepSize(s, 1) ?? null;
      if (s === "2.5em") written.add(s);
    }
    expect([...written].filter((x) => x !== null).sort()).toEqual(["0.75em", "0.875em", "1.25em", "1.5em", "2.5em", "2em"].sort());
  });
});

describe("012 FR-017 the limits", () => {
  it("FR-017 Increase is unavailable only when every part is at 2.5em or above", () => {
    expect(canStep(["2.5em"], 1)).toBe(false);
    expect(canStep(["3em", "2.5em"], 1)).toBe(false);
    expect(canStep(["2.5em", null], 1)).toBe(true);
  });
  it("FR-017 Decrease is unavailable only when every part is at 0.75em or below", () => {
    expect(canStep(["0.75em"], -1)).toBe(false);
    expect(canStep(["0.5em"], -1)).toBe(false);
    expect(canStep(["0.75em", "2em"], -1)).toBe(true);
  });
  it("FR-017 an empty range cannot step", () => {
    expect(canStep([], 1)).toBe(false);
  });
});

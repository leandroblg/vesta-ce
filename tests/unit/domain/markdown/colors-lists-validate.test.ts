import { describe, expect, it } from "vitest";
import { isColorList, isPinnedList } from "../../../../src/domain/markdown/colors";

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}ff`;

describe("FR-016 FR-017 color list validation (011 data-model \"Domain types\")", () => {
  it("FR-012 accepts empty and up to max distinct 8-digit lowercase colors", () => {
    expect(isColorList([], 20)).toBe(true);
    expect(isColorList(Array.from({ length: 20 }, (_, i) => hex(i)), 20)).toBe(true);
  });

  it.each([
    ["not an array", "#ffe066ff"],
    ["one too many", Array.from({ length: 21 }, (_, i) => hex(i))],
    ["a duplicate", ["#ffe066ff", "#ffe066ff"]],
    ["uppercase", ["#FFE066FF"]],
    ["6 digits", ["#ffe066"]],
    ["a name", ["red"]],
    ["a number", [5]],
  ])("FR-017 refuses %s", (_label, value) => {
    expect(isColorList(value, 20)).toBe(false);
  });

  it("FR-011 accepts up to 10 pinned entries with unique hex and a non-negative integer time", () => {
    expect(isPinnedList([])).toBe(true);
    expect(isPinnedList(Array.from({ length: 10 }, (_, i) => ({ hex: hex(i), at: i })))).toBe(true);
  });

  it.each([
    ["11 entries", Array.from({ length: 11 }, (_, i) => ({ hex: hex(i), at: 1 }))],
    ["a duplicate hex", [{ hex: "#ffe066ff", at: 1 }, { hex: "#ffe066ff", at: 2 }]],
    ["a missing time", [{ hex: "#ffe066ff" }]],
    ["a negative time", [{ hex: "#ffe066ff", at: -1 }]],
    ["a fractional time", [{ hex: "#ffe066ff", at: 1.5 }]],
    ["an extra key", [{ hex: "#ffe066ff", at: 1, name: "x" }]],
    ["a bad hex", [{ hex: "#ffe066", at: 1 }]],
    ["a plain string", ["#ffe066ff"]],
  ])("FR-017 refuses a pinned list with %s", (_label, value) => {
    expect(isPinnedList(value)).toBe(false);
  });
});

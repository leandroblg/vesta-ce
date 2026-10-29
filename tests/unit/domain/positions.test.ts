import { describe, expect, it } from "vitest";
import { between, endPosition, needsRenumber, renumber } from "../../../src/domain/positions";

describe("positions (research.md §4)", () => {
  it("endPosition is max + 1, or 1 for an empty list", () => {
    expect(endPosition([])).toBe(1);
    expect(endPosition([1, 4, 2])).toBe(5);
    expect(endPosition([0.5])).toBe(1.5);
  });

  it("between gives the midpoint, or steps past an open side", () => {
    expect(between(1, 2)).toBe(1.5);
    expect(between(null, 2)).toBe(1);
    expect(between(3, null)).toBe(4);
    expect(between(null, null)).toBe(1);
  });

  it("needsRenumber when the gap is under 1e-9", () => {
    expect(needsRenumber(1, 1 + 1e-10)).toBe(true);
    expect(needsRenumber(1, 1.5)).toBe(false);
    expect(needsRenumber(null, 1)).toBe(false);
  });

  it("renumber gives 1, 2, 3 in the current order", () => {
    expect(renumber(["c", "a", "b"])).toEqual(
      new Map([
        ["c", 1],
        ["a", 2],
        ["b", 3],
      ]),
    );
  });
});

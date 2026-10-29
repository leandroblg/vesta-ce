// 011 US3: the size grid's arithmetic (FR-018 to FR-020a).
import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE, gridSize, parseSize } from "../../../../src/domain/editing/table-size";

describe("FR-019 FR-020a table sizes", () => {
  it.each([
    [1, 1, 8, 8],
    [7, 3, 8, 8],
    [8, 8, 9, 9],
    [12, 2, 13, 8],
    [19, 20, 20, 20],
    [20, 20, 20, 20],
  ])("FR-019 the grid shows max(8, highlighted + 1), at most 20: %i × %i → %i × %i", (hc, hr, cols, rows) => {
    expect(gridSize(hc, hr)).toEqual({ cols, rows });
  });

  it.each([
    ["1", 1],
    ["30", 30],
    ["100", 100],
    [" 7 ", 7],
  ])("FR-020a accepts %s", (text, n) => {
    expect(parseSize(text)).toBe(n);
  });

  it.each(["0", "101", "2.5", "", "abc", "-3", "1e2"])("FR-020a refuses %s", (text) => {
    expect(parseSize(text)).toBeNull();
  });

  it("FR-018 the default table is 3 × 3 counting the header", () => {
    expect(DEFAULT_TABLE).toEqual({ cols: 3, rows: 3 });
  });
});

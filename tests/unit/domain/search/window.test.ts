// T053: the window of rows a virtualized search list renders (006 SC-001; research §6).
import { describe, expect, it } from "vitest";
import { visibleWindow } from "../../../../src/domain/search/window";

const H = (n: number, h = 40) => Array.from({ length: n }, () => h);

describe("visibleWindow", () => {
  it("renders the rows in view plus the overscan, with spacers for the rest", () => {
    // 1,000 rows of 40 px; the list starts 200 px down; the viewport shows 600 px from scrollTop 2,200.
    const w = visibleWindow({ heights: H(1000), listTop: 200, scrollTop: 2200, viewport: 600, overscan: 400 });
    // In view: list offsets 2,000–2,600 → rows 50–64; with 400 px overscan each side: rows 40–74.
    expect([w.start, w.end]).toEqual([40, 75]);
    expect(w.before).toBe(40 * 40);
    expect(w.after).toBe((1000 - 75) * 40);
  });

  it("starts at the top when the list is in view from its first row", () => {
    const w = visibleWindow({ heights: H(500), listTop: 0, scrollTop: 0, viewport: 800, overscan: 400 });
    expect([w.start, w.end, w.before]).toEqual([0, 30, 0]);
  });

  it("renders nothing but spacers when the list is far below the viewport", () => {
    const w = visibleWindow({ heights: H(300), listTop: 10_000, scrollTop: 0, viewport: 800, overscan: 400 });
    expect(w.end - w.start).toBe(0);
    expect(w.before + w.after).toBe(300 * 40);
  });

  it("handles rows of different heights", () => {
    const heights = [100, 20, 20, 20, 300, 20, ...H(100, 20)];
    const w = visibleWindow({ heights, listTop: 0, scrollTop: 150, viewport: 100, overscan: 0 });
    // Offsets: 0,100,120,140,160,460…; the view 150–250 covers rows 3 (140–160) and 4 (160–460).
    expect([w.start, w.end]).toEqual([3, 5]);
    expect(w.before).toBe(140);
  });

  it("clamps to the list's end", () => {
    const w = visibleWindow({ heights: H(10), listTop: 0, scrollTop: 0, viewport: 10_000, overscan: 400 });
    expect([w.start, w.end, w.after]).toEqual([0, 10, 0]);
  });
});

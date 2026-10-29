// 015 FR-010b, FR-010c (PRD Q220, Q222; ui.md "Card context menu", "Durations menu"): where menus and rows open.
import { describe, expect, it } from "vitest";
import { place, type Rect } from "../../../src/renderer/components/popover";

const VIEW = { width: 1100, height: 760 };
const box = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height, width, height });
const SIZE = { width: 160, height: 190 };

describe("015 FR-010c the context menu keeps its right edge on the button's", () => {
  it("opens below the button, right edges aligned", () => {
    const button = box(900, 100, 24, 24);
    expect(place("below-right", button, SIZE, VIEW)).toEqual({ left: 924 - 160, top: 128 });
  });

  it("stays 8 px inside the window and flips above with no room below", () => {
    expect(place("below-right", box(4, 100, 24, 24), SIZE, VIEW).left).toBe(8);
    expect(place("below-right", box(900, 700, 24, 24), SIZE, VIEW)).toEqual({ left: 764, top: 700 - 190 - 4 });
  });
});

describe("015 FR-006 FR-010c the hold row opens below its button, centered", () => {
  const ROW = { width: 150, height: 32 };

  it("is centered under the button", () => {
    const button = box(500, 100, 24, 24);
    const at = place("below-center", button, ROW, VIEW);
    expect(at.left + ROW.width / 2).toBe(512);
    expect(at.top).toBe(128);
  });

  it("moves left only as far as the right margin requires", () => {
    const button = box(1100 - 40, 100, 24, 24);
    expect(place("below-center", button, ROW, VIEW).left).toBe(1100 - 8 - 150);
  });
});

describe("015 FR-010b the Postpone For row opens on the menu's left, level with its item", () => {
  const ROW = { width: 150, height: 32 };
  const item = box(780, 200, 150, 24);
  const menu = box(775, 128, 160, 190);

  it("sits left of the menu, vertically centered on the item, so the menu does not move", () => {
    const at = place("left-of-menu", item, ROW, VIEW, menu);
    expect(at.left).toBe(775 - 4 - 150);
    expect(at.top + ROW.height / 2).toBe(212);
  });

  it("flips to the menu's right only when the left has no room", () => {
    const leftMenu = box(60, 128, 160, 190);
    const leftItem = box(65, 200, 150, 24);
    expect(place("left-of-menu", leftItem, ROW, VIEW, leftMenu).left).toBe(220 + 4);
  });
});

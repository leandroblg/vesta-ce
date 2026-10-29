// 015 FR-006a, FR-009, FR-010b, FR-014 (PRD Q220; ui.md "Durations menu"): the keys of a horizontal row of durations.
import { describe, expect, it } from "vitest";
import { rowKey } from "../../../src/renderer/components/DurationsRow";

describe("015 the durations row's keys", () => {
  it("Right and Left move along the row without wrapping; Home and End jump", () => {
    expect(rowKey("ArrowRight", 0, 4, "hold")).toEqual({ focus: 1 });
    expect(rowKey("ArrowRight", 3, 4, "hold")).toEqual({ focus: 3 });
    expect(rowKey("ArrowLeft", 2, 4, "hold")).toEqual({ focus: 1 });
    expect(rowKey("ArrowLeft", 0, 4, "hold")).toEqual({ focus: 0 });
    expect(rowKey("Home", 2, 4, "hold")).toEqual({ focus: 0 });
    expect(rowKey("End", 1, 4, "hold")).toEqual({ focus: 3 });
  });

  it("Esc closes the hold row and returns the focus to its button", () => {
    expect(rowKey("Escape", 1, 4, "hold")).toEqual({ close: true });
  });

  it("in the context menu, Right on the last item (next to the menu) or Esc goes back to Postpone For", () => {
    expect(rowKey("ArrowRight", 3, 4, "submenu")).toEqual({ back: true });
    expect(rowKey("Escape", 0, 4, "submenu")).toEqual({ back: true });
    expect(rowKey("ArrowRight", 1, 4, "submenu")).toEqual({ focus: 2 });
  });

  it("Enter and Space are left to the button (a native click); Up and Down do nothing in a row", () => {
    expect(rowKey("Enter", 1, 4, "hold")).toBeNull();
    expect(rowKey(" ", 1, 4, "hold")).toBeNull();
    expect(rowKey("ArrowDown", 1, 4, "submenu")).toEqual({ focus: 1 });
  });
});

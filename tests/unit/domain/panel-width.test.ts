import { describe, expect, it } from "vitest";
import { clampPanelWidth } from "../../../src/domain/panel-width";

describe("clampPanelWidth (FR-005)", () => {
  it("keeps 300 to 760 px, rounded", () => {
    expect(clampPanelWidth(100)).toBe(300);
    expect(clampPanelWidth(420.6)).toBe(421);
    expect(clampPanelWidth(900)).toBe(760);
  });

  it("limits to 70 % of the window, never under 300 px", () => {
    expect(clampPanelWidth(700, 800)).toBe(560);
    expect(clampPanelWidth(700, 1200)).toBe(700);
    expect(clampPanelWidth(700, 300)).toBe(300);
  });
});

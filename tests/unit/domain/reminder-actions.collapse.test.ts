import { describe, expect, it } from "vitest";
import { setRemindersCollapsed } from "../../../src/domain/reminder-actions";

describe("setRemindersCollapsed (FR-003, FR-008)", () => {
  it("changes only the section state, never a reminder row", () => {
    expect(setRemindersCollapsed(true, false)).toEqual({ upserts: [], removals: [], sectionCollapsed: true });
    expect(setRemindersCollapsed(false, true)).toEqual({ upserts: [], removals: [], sectionCollapsed: false });
  });

  it("is an empty change set when the state does not change", () => {
    const empty = { upserts: [], removals: [], sectionCollapsed: null };
    expect(setRemindersCollapsed(true, true)).toEqual(empty);
    expect(setRemindersCollapsed(false, false)).toEqual(empty);
  });
});

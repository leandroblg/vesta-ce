import { describe, expect, it } from "vitest";
import { DAY_MS, anchorAfterClockBack, reminderDue } from "../../../../src/domain/updates/reminder";

const base = { auto: false, on: true, days: 30, anchor: 1_000_000 };

describe("Q133 update reminder rule (010 FR-033 to FR-035, research §10)", () => {
  it("Q133 is never due while automatic checks are on, the reminder is off or there is no anchor", () => {
    const far = base.anchor + 400 * DAY_MS;
    expect(reminderDue({ ...base, auto: true }, far)).toBe(false);
    expect(reminderDue({ ...base, on: false }, far)).toBe(false);
    expect(reminderDue({ ...base, anchor: null }, far)).toBe(false);
  });

  it("Q133 is due exactly at the period and after, not before", () => {
    expect(reminderDue(base, base.anchor + 30 * DAY_MS - 1)).toBe(false);
    expect(reminderDue(base, base.anchor + 30 * DAY_MS)).toBe(true);
    expect(reminderDue(base, base.anchor + 31 * DAY_MS)).toBe(true);
    expect(reminderDue({ ...base, days: 7 }, base.anchor + 7 * DAY_MS)).toBe(true);
    expect(reminderDue({ ...base, days: 365 }, base.anchor + 364 * DAY_MS)).toBe(false);
  });

  it("Q133 a future anchor counts as now (003 Q99), an earlier one is kept", () => {
    expect(anchorAfterClockBack(5_000, 4_000)).toBe(4_000);
    expect(anchorAfterClockBack(3_000, 4_000)).toBe(3_000);
    expect(anchorAfterClockBack(4_000, 4_000)).toBe(4_000);
  });

  it("Q133 DAY_MS is one day", () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

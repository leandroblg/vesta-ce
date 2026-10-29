import { describe, expect, it } from "vitest";
import {
  ALERT_LIMITS,
  DEFAULT_ALERT_SETTINGS,
  clampField,
  fieldMax,
  normalizeAlertSettings,
  quickDurations,
  splitMinutes,
  validDuration,
  validOverride,
} from "../../../src/domain/alert-settings";

/** The four quick reschedule durations at their defaults (015 Q207), for tests that only vary the other keys. */
const QUICK = { quickReschedule1Min: "60", quickReschedule2Min: "120", quickReschedule3Min: "240", quickReschedule4Min: "360" };
const QUICK_N = { quickReschedule1Min: 60, quickReschedule2Min: 120, quickReschedule3Min: 240, quickReschedule4Min: 360 };

describe("alert settings defaults and limits (FR-001)", () => {
  it("has the PRD A4 defaults", () => {
    expect(DEFAULT_ALERT_SETTINGS).toEqual({ alertPeriodMin: 1440, reblinkIntervalMin: 240, rescheduleToleranceMin: 1440, ...QUICK_N });
  });

  it("has the PRD A4 limits", () => {
    expect(ALERT_LIMITS).toEqual({
      alertPeriodMin: { min: 60, max: 14_399_999 },
      reblinkIntervalMin: { min: 30, max: 43_200 },
      rescheduleToleranceMin: { min: 60, max: 43_200 },
      quickReschedule1Min: { min: 60, max: 43_200 },
      quickReschedule2Min: { min: 60, max: 43_200 },
      quickReschedule3Min: { min: 60, max: 43_200 },
      quickReschedule4Min: { min: 60, max: 43_200 },
    });
  });
});

describe("normalizeAlertSettings (FR-001)", () => {
  it("passes valid values with no issue", () => {
    const r = normalizeAlertSettings({ alertPeriodMin: "2880", reblinkIntervalMin: "60", rescheduleToleranceMin: "120", ...QUICK });
    expect(r.settings).toEqual({ alertPeriodMin: 2880, reblinkIntervalMin: 60, rescheduleToleranceMin: 120, ...QUICK_N });
    expect(r.issues).toEqual([]);
  });

  it("uses the default for a missing value and reports it", () => {
    const r = normalizeAlertSettings({ reblinkIntervalMin: "240", rescheduleToleranceMin: "1440", ...QUICK });
    expect(r.settings.alertPeriodMin).toBe(1440);
    expect(r.issues).toEqual([{ key: "alertPeriodMin", kind: "missing" }]);
  });

  it("uses the default for an unreadable value and reports it", () => {
    for (const raw of ["abc", "", "12.5", "null", "[]"]) {
      const r = normalizeAlertSettings({ alertPeriodMin: "1440", reblinkIntervalMin: raw, rescheduleToleranceMin: "1440", ...QUICK });
      expect(r.settings.reblinkIntervalMin).toBe(240);
      expect(r.issues).toEqual([{ key: "reblinkIntervalMin", kind: "unreadable" }]);
    }
  });

  it("brings an out-of-range value to the nearest limit and reports it", () => {
    const r = normalizeAlertSettings({ alertPeriodMin: "30", reblinkIntervalMin: "60000", rescheduleToleranceMin: "0", ...QUICK });
    expect(r.settings).toEqual({ alertPeriodMin: 60, reblinkIntervalMin: 43_200, rescheduleToleranceMin: 60, ...QUICK_N });
    expect(r.issues).toEqual([
      { key: "alertPeriodMin", kind: "clamped" },
      { key: "reblinkIntervalMin", kind: "clamped" },
      { key: "rescheduleToleranceMin", kind: "clamped" },
    ]);
  });
});

describe("validOverride (FR-035, FR-037)", () => {
  it("returns the total in minutes for a valid combination", () => {
    expect(validOverride(7, 0, 0)).toBe(10_080);
    expect(validOverride(0, 1, 0)).toBe(60);
    expect(validOverride(9999, 23, 59)).toBe(14_399_999);
  });

  it("refuses a total below 1 hour", () => {
    expect(validOverride(0, 0, 30)).toBe("min1h");
    expect(validOverride(0, 0, 59)).toBe("min1h");
    expect(validOverride(0, 0, 0)).toBe("min1h");
  });

  it("refuses a field outside its range or not a whole number", () => {
    expect(validOverride(10_000, 0, 0)).toBe("range");
    expect(validOverride(0, 24, 0)).toBe("range");
    expect(validOverride(0, 1, 60)).toBe("range");
    expect(validOverride(-1, 5, 0)).toBe("range");
    expect(validOverride(1.5, 0, 0)).toBe("range");
    expect(validOverride(Number.NaN, 0, 0)).toBe("range");
  });
});

describe("splitMinutes", () => {
  it("splits a total into days, hours and minutes", () => {
    expect(splitMinutes(1440)).toEqual({ days: 1, hours: 0, minutes: 0 });
    expect(splitMinutes(10_080)).toEqual({ days: 7, hours: 0, minutes: 0 });
    expect(splitMinutes(14_399_999)).toEqual({ days: 9999, hours: 23, minutes: 59 });
    expect(splitMinutes(125)).toEqual({ days: 0, hours: 2, minutes: 5 });
  });
});

describe("validDuration (007 FR-006, data-model field rules)", () => {
  it.each([
    ["alertPeriodMin", 0, 0, 59, "min"],
    ["alertPeriodMin", 0, 1, 0, 60],
    ["alertPeriodMin", 9999, 23, 59, 14_399_999],
    ["alertPeriodMin", 10000, 0, 0, "range"],
    ["reblinkIntervalMin", 0, 0, 29, "min"],
    ["reblinkIntervalMin", 0, 0, 30, 30],
    ["reblinkIntervalMin", 30, 0, 0, 43_200],
    ["reblinkIntervalMin", 30, 0, 1, "range"],
    ["reblinkIntervalMin", 31, 0, 0, "range"],
    ["rescheduleToleranceMin", 0, 0, 59, "min"],
    ["rescheduleToleranceMin", 30, 0, 0, 43_200],
    ["rescheduleToleranceMin", 0, 24, 0, "range"],
    ["rescheduleToleranceMin", 0, 1, 60, "range"],
    ["alertPeriodMin", Number.NaN, 1, 0, "range"],
    ["alertPeriodMin", 0, 1.5, 0, "range"],
  ] as const)("%s %d d %d h %d min → %s", (key, d, h, m, expected) => {
    expect(validDuration(key, d, h, m)).toBe(expected);
  });

  it("keeps validOverride's results (003 FR-037)", () => {
    expect(validOverride(0, 0, 59)).toBe("min1h");
    expect(validOverride(7, 0, 0)).toBe(10_080);
    expect(validOverride(0, 24, 0)).toBe("range");
  });
});

describe("quick reschedule durations (015 Q207, FR-012)", () => {
  const base = { alertPeriodMin: "1440", reblinkIntervalMin: "240", rescheduleToleranceMin: "1440" };

  it("reads the four values and returns them in order", () => {
    const r = normalizeAlertSettings({ ...base, quickReschedule1Min: "90", quickReschedule2Min: "180", quickReschedule3Min: "300", quickReschedule4Min: "720" });
    expect(r.issues).toEqual([]);
    expect(quickDurations(r.settings)).toEqual([90, 180, 300, 720]);
  });

  it("uses the defaults 1h, 2h, 4h and 6h for missing values and reports each", () => {
    const r = normalizeAlertSettings(base);
    expect(quickDurations(r.settings)).toEqual([60, 120, 240, 360]);
    expect(r.issues).toEqual([
      { key: "quickReschedule1Min", kind: "missing" },
      { key: "quickReschedule2Min", kind: "missing" },
      { key: "quickReschedule3Min", kind: "missing" },
      { key: "quickReschedule4Min", kind: "missing" },
    ]);
  });

  it("clamps to 60–43,200 and reports unreadable values", () => {
    const r = normalizeAlertSettings({ ...base, ...QUICK, quickReschedule1Min: "30", quickReschedule2Min: "50000", quickReschedule3Min: "x" });
    expect(quickDurations(r.settings)).toEqual([60, 43_200, 240, 360]);
    expect(r.issues).toEqual([
      { key: "quickReschedule1Min", kind: "clamped" },
      { key: "quickReschedule2Min", kind: "clamped" },
      { key: "quickReschedule3Min", kind: "unreadable" },
    ]);
  });

  it("accepts 0–30 days in the fields, 1 hour to 720 hours in total", () => {
    expect(validDuration("quickReschedule1Min", 0, 1, 0)).toBe(60);
    expect(validDuration("quickReschedule2Min", 30, 0, 0)).toBe(43_200);
    expect(validDuration("quickReschedule3Min", 0, 0, 59)).toBe("min");
    expect(validDuration("quickReschedule4Min", 30, 0, 1)).toBe("range");
    expect(validDuration("quickReschedule4Min", 31, 0, 0)).toBe("range");
  });
});

describe("016 FR-031, FR-032 a typed value above a field's maximum becomes the maximum at once (PRD Q237)", () => {
  const f = (days: string, hours: string, minutes: string) => ({ days, hours, minutes });
  it("caps minutes at 59, hours at 23, days at 30, or 9999 for the alert period", () => {
    expect(fieldMax("rescheduleToleranceMin", "days")).toBe(30);
    expect(fieldMax("alertPeriodMin", "days")).toBe(9999);
    expect(clampField("rescheduleToleranceMin", "minutes", "75", f("0", "5", "0"))).toEqual(f("0", "5", "59"));
    expect(clampField("reblinkIntervalMin", "hours", "30", f("0", "0", "0"))).toEqual(f("0", "23", "0"));
    expect(clampField("alertPeriodMin", "days", "45", f("0", "5", "7"))).toEqual(f("45", "5", "7"));
    expect(clampField("alertPeriodMin", "days", "12000", f("0", "0", "0"))).toEqual(f("9999", "0", "0"));
    expect(clampField("alertPeriodMin", "hours", "99", f("1", "0", "0"))).toEqual(f("1", "23", "0"));
  });
  it("on a 30-day setting, days 30 zero the hours and minutes, and hours or minutes typed while days is 30 become 0", () => {
    for (const key of ["reblinkIntervalMin", "rescheduleToleranceMin", "quickReschedule1Min", "quickReschedule4Min"] as const) {
      expect(clampField(key, "days", "45", f("0", "5", "10")), key).toEqual(f("30", "0", "0"));
      expect(clampField(key, "days", "30", f("0", "5", "10")), key).toEqual(f("30", "0", "0"));
      expect(clampField(key, "hours", "5", f("30", "0", "0")), key).toEqual(f("30", "0", "0"));
      expect(clampField(key, "minutes", "7", f("30", "0", "0")), key).toEqual(f("30", "0", "0"));
      expect(clampField(key, "hours", "5", f("29", "0", "0")), key).toEqual(f("29", "5", "0"));
    }
    expect(clampField("alertPeriodMin", "hours", "5", f("30", "0", "0"))).toEqual(f("30", "5", "0"));
  });
  it("leaves an empty or non-numeric field as typed, for the usual validation", () => {
    expect(clampField("rescheduleToleranceMin", "hours", "", f("1", "2", "3"))).toEqual(f("1", "", "3"));
    expect(clampField("rescheduleToleranceMin", "hours", "x", f("1", "2", "3"))).toEqual(f("1", "x", "3"));
  });
  it("a value below the minimum is not raised: the minimum keeps its error (FR-033)", () => {
    expect(clampField("rescheduleToleranceMin", "minutes", "10", f("0", "0", "0"))).toEqual(f("0", "0", "10"));
    expect(validDuration("rescheduleToleranceMin", 0, 0, 10)).toBe("min");
  });
});

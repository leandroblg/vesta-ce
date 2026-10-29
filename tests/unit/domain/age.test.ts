import { describe, expect, it } from "vitest";
import { formatAge, formatDuration, formatRange, type AgeUnits } from "../../../src/domain/age";

const EN: AgeUnits = { d: "d", h: "h", m: "m" };
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatAge (FR-012, FR-013)", () => {
  it("uses two units, largest first", () => {
    expect(formatAge(12 * DAY + 3 * HOUR + 20 * MIN, EN)).toBe("12d 3h");
    expect(formatAge(5 * HOUR + 40 * MIN, EN)).toBe("5h 40m");
    expect(formatAge(40 * MIN, EN)).toBe("40m");
  });

  it("states its boundaries and rounds down", () => {
    expect(formatAge(DAY, EN)).toBe("1d 0h");
    expect(formatAge(DAY - MIN, EN)).toBe("23h 59m");
    expect(formatAge(HOUR, EN)).toBe("1h 0m");
    expect(formatAge(HOUR - 1000, EN)).toBe("59m");
    expect(formatAge(2 * DAY + 59 * MIN, EN)).toBe("2d 0h");
  });

  it("never shows a negative age (FR-045a, FR-040)", () => {
    expect(formatAge(-5 * HOUR, EN)).toBe("0m");
    expect(formatAge(0, EN)).toBe("0m");
  });

  it("takes the unit letters from the caller", () => {
    expect(formatAge(12 * DAY + 3 * HOUR, { d: "j", h: "h", m: "min" })).toBe("12j 3h");
    expect(formatAge(5 * HOUR + 40 * MIN, { d: "d", h: "h", m: "min" })).toBe("5h 40min");
  });
});

describe("formatDuration", () => {
  it("lists the non-zero parts", () => {
    expect(formatDuration(1440, EN)).toBe("1d");
    expect(formatDuration(10_080, EN)).toBe("7d");
    expect(formatDuration(1440 + 120 + 5, EN)).toBe("1d 2h 5m");
    expect(formatDuration(90, EN)).toBe("1h 30m");
    expect(formatDuration(0, EN)).toBe("0m");
  });
});

describe("formatRange (007 FR-007, analysis CHK006)", () => {
  const en = { d: "d", h: "h", m: "m" };
  const fr = { d: "j", h: "h", m: "min" };

  it("016 FR-034 (Q238): minutes below an hour, a whole number of days in days, whole hours in hours, else days, hours, minutes", () => {
    expect(formatRange(30, 43_200, en)).toBe("30m – 30d");
    expect(formatRange(60, 43_200, en)).toBe("1h – 30d");
    expect(formatRange(30, 43_200, fr)).toBe("30min – 30j");
    expect(formatRange(60, 14_399_999, en)).toBe("1h – 9999d 23h 59m");
    expect(formatRange(120, 1_440, en)).toBe("2h – 1d");
    expect(formatRange(60, 1_500, en)).toBe("1h – 1d 1h");
  });
});

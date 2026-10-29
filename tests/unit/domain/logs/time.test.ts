import { describe, expect, it } from "vitest";
import { formatLogTime } from "../../../../src/domain/logs/time";

const T = Date.UTC(2026, 9, 19, 20, 0, 3, 123);

describe("formatLogTime (009 FR-016, clarification 2026-10-19)", () => {
  it("shows local time as a fixed timestamp marked with its UTC offset in hours", () => {
    expect(formatLogTime(T, -180)).toBe("2026-10-19 17:00:03.123 -3");
    expect(formatLogTime(T, 330)).toBe("2026-10-20 01:30:03.123 +5:30");
    expect(formatLogTime(T, 0)).toBe("2026-10-19 20:00:03.123 +0");
    expect(formatLogTime(T, -570)).toBe("2026-10-19 10:30:03.123 -9:30");
    expect(formatLogTime(T, 60)).toBe("2026-10-19 21:00:03.123 +1");
  });

  it("crosses midnight and the end of a year", () => {
    expect(formatLogTime(Date.UTC(2026, 11, 31, 23, 30, 0, 5), 120)).toBe("2027-01-01 01:30:00.005 +2");
    expect(formatLogTime(Date.UTC(2027, 0, 1, 1, 0, 0, 0), -300)).toBe("2026-12-31 20:00:00.000 -5");
  });

  it("pads every part", () => {
    expect(formatLogTime(Date.UTC(2026, 0, 2, 3, 4, 5, 6), 0)).toBe("2026-01-02 03:04:05.006 +0");
  });
});

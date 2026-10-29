import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS, SPACING_MS, afterAttempt, initialSchedule, isDue, mayRequest, nextDue } from "../../../../src/domain/updates/schedule";

const T0 = Date.UTC(2026, 9, 19, 9, 0, 0);

describe("the update schedule (009 FR-021, FR-021a, FR-022b; PRD Q124)", () => {
  it("is due at once after the start, with automatic checks on", () => {
    const s = initialSchedule(true);
    expect(nextDue(s)).toBe(Number.NEGATIVE_INFINITY);
    expect(isDue(s, T0)).toBe(true);
  });

  it("is due 24 h after a success, 1 h after a failure, hourly until a success", () => {
    let s = afterAttempt(initialSchedule(true), T0, true);
    expect(nextDue(s)).toBe(T0 + DAY_MS);
    expect(isDue(s, T0 + DAY_MS - 1)).toBe(false);
    expect(isDue(s, T0 + DAY_MS)).toBe(true);
    s = afterAttempt(s, T0 + DAY_MS, false);
    expect(nextDue(s)).toBe(T0 + DAY_MS + HOUR_MS);
    s = afterAttempt(s, T0 + DAY_MS + HOUR_MS, false);
    expect(nextDue(s)).toBe(T0 + DAY_MS + 2 * HOUR_MS);
    s = afterAttempt(s, T0 + DAY_MS + 2 * HOUR_MS, true);
    expect(nextDue(s)).toBe(T0 + 2 * DAY_MS + 2 * HOUR_MS);
  });

  it("never requests twice within a minute, whatever triggered it", () => {
    const s = afterAttempt(initialSchedule(true), T0, true);
    expect(SPACING_MS).toBe(60_000);
    expect(mayRequest(s, T0 + 30_000)).toBe(false);
    expect(mayRequest(s, T0 + 60_000)).toBe(true);
    expect(mayRequest({ ...s, running: true }, T0 + DAY_MS)).toBe(false);
  });

  it("is never due while automatic checks are off, even after a failure", () => {
    let s = afterAttempt(initialSchedule(false), T0, false);
    expect(nextDue(s)).toBeNull();
    expect(isDue(s, T0 + 10 * DAY_MS)).toBe(false);
    s = { ...s, auto: true };
    expect(isDue(s, T0 + HOUR_MS)).toBe(true);
  });

  it("ticking the box makes a check due at once, still a minute after the last request", () => {
    const off = afterAttempt(initialSchedule(false), T0, true);
    const on = { ...off, auto: true, dueNow: true };
    expect(isDue(on, T0 + 30_000)).toBe(false);
    expect(isDue(on, T0 + 60_000)).toBe(true);
  });

  it("is due after the computer slept past the due time, and when the clock went backwards", () => {
    const s = afterAttempt(initialSchedule(true), T0, true);
    expect(isDue(s, T0 + 3 * DAY_MS)).toBe(true);
    expect(isDue(s, T0 - DAY_MS)).toBe(true);
  });
});

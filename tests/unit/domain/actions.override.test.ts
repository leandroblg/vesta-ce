/** Alert override (003 FR-034 to FR-039, FR-009; T051). */
import { describe, expect, it } from "vitest";
import { setAlertOverride } from "../../../src/domain/actions";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { evaluateAlerts } from "../../../src/domain/alerts";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError, type Task } from "../../../src/domain/task";
import { mk } from "./fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = 1_000_000_000_000;
const NOW = T + 30 * HOUR;
const clock = fixedClock(NOW);

describe("setAlertOverride", () => {
  it("sets an override and updates the last-edit time", () => {
    const a = mk({ createdAt: T });
    expect(setAlertOverride(a.id, 2880, [a], clock).upserts).toEqual([{ ...a, alertOverrideMin: 2880, updatedAt: NOW }]);
  });

  it("clears it with null", () => {
    const a = mk({ createdAt: T, alertOverrideMin: 600 });
    expect(setAlertOverride(a.id, null, [a], clock).upserts).toEqual([{ ...a, alertOverrideMin: null, updatedAt: NOW }]);
  });

  it("saves nothing when unchanged", () => {
    const a = mk({ alertOverrideMin: 600 });
    expect(setAlertOverride(a.id, 600, [a], clock)).toEqual({ upserts: [], removals: [] });
    const b = mk();
    expect(setAlertOverride(b.id, null, [b], clock)).toEqual({ upserts: [], removals: [] });
  });

  it("refuses values outside the limits and inactive tasks", () => {
    const a = mk();
    for (const minutes of [59, 14_400_000, 90.5]) expect(() => setAlertOverride(a.id, minutes, [a], clock)).toThrow(DomainError);
    const done = mk({ doneAt: 1 });
    expect(() => setAlertOverride(done.id, 600, [done], clock)).toThrow(DomainError);
  });

  // 012 replaces 003 FR-039 ("the stale state never changes here"), PRD Q158.
  it("FR-028 a rescheduled stale task keeps its stale state", () => {
    const stale = mk({ createdAt: T, staleBaseAt: T + HOUR, staleSince: T + 25 * HOUR, wasStale: true });
    const [back] = setAlertOverride(stale.id, 7 * 1440, [stale], clock, DEFAULT_ALERT_SETTINGS).upserts;
    expect(back?.staleSince).toBe(T + 25 * HOUR);
  });
});

describe("012 FR-026 FR-031 an override change and a stale task", () => {
  const stale = () => mk({ createdAt: T, staleSince: T + DAY, wasStale: true, lastBlinkAt: T + DAY + 1, firstBlinkCount: 3, position: 4 });

  it("FR-026 a longer override un-stales a never-rescheduled task; only that task's last edit changes", () => {
    const a = stale();
    const other = mk({ createdAt: T, staleSince: T + DAY, wasStale: true });
    const { upserts } = setAlertOverride(a.id, 7 * 1440, [a, other], clock, DEFAULT_ALERT_SETTINGS);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ id: a.id, alertOverrideMin: 7 * 1440, staleSince: null, lastBlinkAt: null, firstBlinkCount: null, wasStale: true, updatedAt: NOW });
  });

  it("FR-029 the un-staled pinned task moves to the top of the non-pinned tasks", () => {
    const a = stale();
    const plain = mk({ createdAt: NOW - HOUR, position: 1 });
    const [back] = setAlertOverride(a.id, 7 * 1440, [a, plain], clock, DEFAULT_ALERT_SETTINGS).upserts;
    expect(back?.position).toBeLessThan(1);
  });

  it("FR-026 a shorter override keeps it stale", () => {
    const a = stale();
    const [back] = setAlertOverride(a.id, 2 * 60, [a], clock, DEFAULT_ALERT_SETTINGS).upserts;
    expect(back?.staleSince).toBe(T + DAY);
    expect(back?.alertOverrideMin).toBe(120);
  });

  it("FR-026 ticking Use global default (null) uses the global period", () => {
    const a = { ...stale(), alertOverrideMin: 600 };
    const longGlobal = { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 7 * 1440 };
    expect(setAlertOverride(a.id, null, [a], clock, longGlobal).upserts[0]?.staleSince).toBeNull();
    expect(setAlertOverride(a.id, null, [a], clock, DEFAULT_ALERT_SETTINGS).upserts[0]?.staleSince).toBe(T + DAY);
  });

  it("Edge Cases unticking with the value shown keeps the effective period and the stale state", () => {
    const a = stale();
    const [back] = setAlertOverride(a.id, DEFAULT_ALERT_SETTINGS.alertPeriodMin, [a], clock, DEFAULT_ALERT_SETTINGS).upserts;
    expect(back?.staleSince).toBe(T + DAY);
  });
});

describe("an override changes the threshold at once (FR-009)", () => {
  const evaluate = (rows: Task[]) =>
    evaluateAlerts({ tasks: rows, settings: DEFAULT_ALERT_SETTINGS, now: NOW, visibility: { visible: true, visibleSince: T } });

  it("a 30 h-old task with a 2-day override stays non-stale; with 1 day it is stale at once, 3 blinks", () => {
    const a = mk({ createdAt: T });
    const twoDays = setAlertOverride(a.id, 2880, [a], clock).upserts;
    expect(evaluate(twoDays).upserts).toEqual([]);
    const oneDay = setAlertOverride(a.id, 1440, twoDays, clock).upserts;
    const r = evaluate(oneDay);
    expect(r.upserts[0]).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 3 });
    expect(r.episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });

  // 012 FR-026: raised past now it un-stales; removed (back to the 24 h global) it stays stale.
  it("FR-026 a stale task un-stales when its override is raised past now, and stays stale when it is removed", () => {
    const stale = mk({ createdAt: T, staleSince: T + DAY, wasStale: true, lastBlinkAt: T + DAY + 1, firstBlinkCount: 3, alertOverrideMin: 1440 });
    const raised = setAlertOverride(stale.id, 7 * 1440, [stale], clock, DEFAULT_ALERT_SETTINGS).upserts;
    expect(evaluate(raised).upserts.find((t) => t.id === stale.id)?.staleSince ?? raised[0]?.staleSince).toBeNull();
    const removed = setAlertOverride(stale.id, null, [stale], clock, DEFAULT_ALERT_SETTINGS).upserts;
    const after = evaluate(removed).upserts.find((t) => t.id === stale.id) ?? removed[0];
    expect(after?.staleSince).toBe(T + DAY);
  });
});

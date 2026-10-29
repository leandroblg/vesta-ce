/** Reschedule (003 FR-029 to FR-032; T046). */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { crossedThreshold, evaluateAlerts } from "../../../src/domain/alerts";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError, type Task } from "../../../src/domain/task";
import { activeTree } from "../../../src/domain/tree";
import { create, reschedule } from "../../../src/domain/actions";
import { idGen, mk } from "./fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = 1_000_000_000_000;
const R = T + 2 * DAY;
const get = (cs: { upserts: Task[] }, id: string) => cs.upserts.find((t) => t.id === id) as Task;
/** A task created an hour before R: not stale. */
const fresh = (o: Partial<Task> = {}) => mk({ createdAt: R - HOUR, ...o });
const staleRow = (o: Partial<Task> = {}) =>
  mk({ createdAt: T, staleBaseAt: T, staleSince: T + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: T + DAY + 5, ...o });

describe("reschedule", () => {
  it("clears the stale state, restarts the countdown from now, keeps the stale history (FR-030)", () => {
    const a = staleRow();
    const back = get(reschedule(a.id, [a], fixedClock(R)), a.id);
    expect(back).toMatchObject({ staleSince: null, firstBlinkCount: null, staleBaseAt: R, updatedAt: R, wasStale: true, lastBlinkAt: T + DAY + 5 });
  });

  it("moves a pinned top-level task to the top of the non-pinned tasks (FR-031)", () => {
    const pinned = staleRow({ position: 5 });
    const other = staleRow({ position: 1, createdAt: T - DAY, staleSince: T });
    const a = fresh({ position: 2 });
    const b = fresh({ position: 3 });
    const back = get(reschedule(pinned.id, [pinned, other, a, b], fixedClock(R)), pinned.id);
    expect(back.position).toBeLessThan(2);
    const tree = activeTree([other, a, b, back]).map((n) => n.task.id);
    expect(tree).toEqual([other.id, pinned.id, a.id, b.id]);
  });

  it("with no non-pinned task, keeps a position that sorts first", () => {
    const pinned = staleRow({ position: 5 });
    const back = get(reschedule(pinned.id, [pinned], fixedClock(R)), pinned.id);
    expect(activeTree([back]).map((n) => n.task.id)).toEqual([pinned.id]);
  });

  it("keeps a manually positioned task and a subtask where they are", () => {
    const manual = staleRow({ position: 7, manuallyPositioned: true });
    expect(get(reschedule(manual.id, [manual, fresh({ position: 1 })], fixedClock(R)), manual.id).position).toBe(7);
    const p = fresh({ position: 1 });
    const sub = staleRow({ parentId: p.id, position: 3 });
    expect(get(reschedule(sub.id, [p, sub], fixedClock(R)), sub.id).position).toBe(3);
  });

  it("accepts a task past its threshold whose stale state was not saved yet (a failed tick save, FR-044)", () => {
    const shownStale = mk({ createdAt: T, staleBaseAt: T, position: 5 });
    const other = fresh({ position: 1 });
    const back = get(reschedule(shownStale.id, [shownStale, other], fixedClock(R), DEFAULT_ALERT_SETTINGS), shownStale.id);
    expect(back).toMatchObject({ staleSince: null, staleBaseAt: R, wasStale: true });
    expect(back.position).toBeLessThan(1);
  });

  it("015 FR-004/FR-005: reschedules a task that is not stale, restarting its clock without marking it as having been stale", () => {
    const young = fresh({ position: 4 });
    const back = get(reschedule(young.id, [young], fixedClock(R)), young.id);
    expect(back).toMatchObject({ staleSince: null, staleBaseAt: R, updatedAt: R, wasStale: false, rescheduleForMin: null, position: 4 });
  });

  it("015 FR-005: a task stale before, not stale now, stays counted as having been stale", () => {
    const before = fresh({ staleBaseAt: R - HOUR / 2, wasStale: true });
    expect(get(reschedule(before.id, [before], fixedClock(R)), before.id).wasStale).toBe(true);
  });

  it("015 US1 2: a task rescheduled before going stale goes stale one tolerance after the reschedule, not at its first period's end", () => {
    const young = mk({ createdAt: R - 23 * HOUR });
    const back = get(reschedule(young.id, [young], fixedClock(R)), young.id);
    expect(crossedThreshold(back, DEFAULT_ALERT_SETTINGS, R + 2 * HOUR)).toBe(false);
    expect(crossedThreshold(back, DEFAULT_ALERT_SETTINGS, R + DAY - 1)).toBe(false);
    expect(crossedThreshold(back, DEFAULT_ALERT_SETTINGS, R + DAY + 1)).toBe(true);
  });

  it("015 FR-008: stores the quick duration; refuses one outside 60–43,200 minutes", () => {
    const a = staleRow();
    expect(get(reschedule(a.id, [a], fixedClock(R), DEFAULT_ALERT_SETTINGS, 120), a.id).rescheduleForMin).toBe(120);
    for (const bad of [59, 43_201, 90.5]) expect(() => reschedule(a.id, [a], fixedClock(R), DEFAULT_ALERT_SETTINGS, bad)).toThrow(DomainError);
  });

  it("015: a later reschedule by the tolerance clears an earlier quick duration", () => {
    const a = staleRow({ rescheduleForMin: 120 });
    expect(get(reschedule(a.id, [a], fixedClock(R)), a.id).rescheduleForMin).toBeNull();
  });

  it("refuses a done or deleted task (FR-029)", () => {
    const done = staleRow({ doneAt: R - 1 });
    expect(() => reschedule(done.id, [done], fixedClock(R))).toThrow(DomainError);
    const deleted = fresh({ deletedAt: R - 1 });
    expect(() => reschedule(deleted.id, [deleted], fixedClock(R))).toThrow(DomainError);
  });

  it("after a reschedule the task stays first among non-pinned tasks when a new task is created (CHK032)", () => {
    const pinned = staleRow({ position: 5 });
    const a = fresh({ position: 1 });
    const back = get(reschedule(pinned.id, [pinned, a], fixedClock(R)), pinned.id);
    const created = create({ title: "New", parentId: null }, [back, a], fixedClock(R + 1), idGen(900)).upserts[0] as Task;
    expect(activeTree([back, a, created]).map((n) => n.task.id)).toEqual([pinned.id, a.id, created.id]);
  });
});

describe("reschedule and the next stale moment (FR-032)", () => {
  const vis = { visible: true, visibleSince: T };
  const tick = (rows: Task[], now: number) => {
    const r = evaluateAlerts({ tasks: rows, settings: DEFAULT_ALERT_SETTINGS, now, visibility: vis });
    const byId = new Map(r.upserts.map((u) => [u.id, u]));
    return rows.map((t) => byId.get(t.id) ?? t);
  };

  it("is stale again 1 ms after reschedule time + tolerance, even with a 7-day override", () => {
    const a = staleRow({ alertOverrideMin: 7 * 1440 });
    let rows = reschedule(a.id, [a], fixedClock(R)).upserts;
    rows = tick(rows, R + DAY);
    expect(rows[0]?.staleSince).toBeNull();
    rows = tick(rows, R + DAY + 1);
    expect(rows[0]?.staleSince).toBe(R + DAY);
  });

  it("rescheduled twice, the tolerance counts from the second reschedule", () => {
    const a = staleRow();
    let rows = reschedule(a.id, [a], fixedClock(R)).upserts;
    rows = tick(rows, R + DAY + 1);
    rows = reschedule(a.id, rows, fixedClock(R + DAY + HOUR)).upserts;
    rows = tick(rows, R + 2 * DAY + 1);
    expect(rows[0]?.staleSince).toBeNull();
    rows = tick(rows, R + 2 * DAY + HOUR + 1);
    expect(rows[0]?.staleSince).toBe(R + 2 * DAY + HOUR);
  });
});

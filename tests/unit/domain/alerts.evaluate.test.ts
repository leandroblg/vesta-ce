/** evaluateAlerts with a fake clock: one named case per PRD A4 rule and timing-checklist scenario (003 T030). */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from "../../../src/domain/alert-settings";
import { evaluateAlerts, staleMomentOf, type Episode, type Visibility } from "../../../src/domain/alerts";
import { applyPeriodChange } from "../../../src/domain/period-change";
import { fakeClock } from "../../../src/domain/clock";
import type { Task } from "../../../src/domain/task";
import { mk } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = 1_000_000_000_000;

const VISIBLE_SINCE_T: Visibility = { visible: true, visibleSince: T };
const HIDDEN: Visibility = { visible: false, visibleSince: T };

/** A small world: tasks plus settings; each tick applies its upserts, like main saving them. */
function world(tasks: Task[], settings: AlertSettings = DEFAULT_ALERT_SETTINGS) {
  let rows = tasks;
  return {
    tick(now: number, visibility: Visibility): { episodes: Episode[]; upserts: Task[] } {
      const r = evaluateAlerts({ tasks: rows, settings, now, visibility });
      const byId = new Map(r.upserts.map((u) => [u.id, u]));
      rows = rows.map((t) => byId.get(t.id) ?? t);
      return r;
    },
    get: (id: string) => rows.find((t) => t.id === id) as Task,
    set(next: Task[]) {
      rows = next;
    },
    rows: () => rows,
  };
}

const task = (o: Partial<Task> = {}) => mk({ createdAt: T, updatedAt: T, ...o });

describe("threshold and boundary (FR-004, FR-006, CHK014–016)", () => {
  it("is not stale at T + 23 h 59 min or at exactly T + 24 h", () => {
    const a = task();
    const w = world([a]);
    expect(w.tick(T + DAY - MIN, VISIBLE_SINCE_T).upserts).toEqual([]);
    expect(w.tick(T + DAY, VISIBLE_SINCE_T).upserts).toEqual([]);
    expect(w.get(a.id).staleSince).toBeNull();
  });

  it("is stale 1 ms after the threshold, with the stale moment exactly at the threshold", () => {
    const a = task();
    const w = world([a]);
    w.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id)).toMatchObject({ staleSince: T + DAY, wasStale: true });
  });

  it("records the crossing moment, not the evaluation time (detected 59 s late)", () => {
    const a = task();
    const w = world([a]);
    w.tick(T + DAY + 59_000, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(T + DAY);
  });

  it("editing the title (new updatedAt, same createdAt) changes nothing (CHK002)", () => {
    const a = task({ updatedAt: T + 23 * HOUR, titleMd: "edited" });
    const w = world([a]);
    w.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(T + DAY);
  });

  it("never evaluates done or deleted tasks (FR-008)", () => {
    const done = task({ doneAt: T + HOUR });
    const deleted = task({ deletedAt: T + HOUR });
    expect(world([done, deleted]).tick(T + 10 * DAY, VISIBLE_SINCE_T)).toEqual({ upserts: [], episodes: [] });
  });

  it("never touches updatedAt (FR-044)", () => {
    const a = task();
    const w = world([a]);
    w.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).updatedAt).toBe(T);
  });
});

describe("override vs global default (FR-003)", () => {
  it("a 7-day override goes stale after 7 days; the same task without it after 1 day", () => {
    const a = task();
    const b = task({ alertOverrideMin: 7 * 1440 });
    const w = world([a, b]);
    w.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(T + DAY);
    expect(w.get(b.id).staleSince).toBeNull();
    w.tick(T + 7 * DAY - MIN, VISIBLE_SINCE_T);
    expect(w.get(b.id).staleSince).toBeNull();
    w.tick(T + 7 * DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(b.id).staleSince).toBe(T + 7 * DAY);
  });
});

describe("rescheduled task (FR-004)", () => {
  it("uses the reschedule tolerance, not the override, once staleBaseAt is after createdAt", () => {
    const R = T + 3 * DAY;
    const a = task({ staleBaseAt: R, wasStale: true, alertOverrideMin: 7 * 1440 });
    const w = world([a], { ...DEFAULT_ALERT_SETTINGS, rescheduleToleranceMin: 600 });
    w.tick(R + 10 * HOUR, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBeNull();
    w.tick(R + 10 * HOUR + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(R + 10 * HOUR);
  });
});

describe("015 quick reschedule durations (FR-008, PRD Q207)", () => {
  it("a task rescheduled for 2 h goes stale exactly 2 h after the reschedule, not after the tolerance", () => {
    const R = T + 3 * DAY;
    const a = task({ staleBaseAt: R, wasStale: true, rescheduleForMin: 120 });
    const w = world([a]);
    w.tick(R + 2 * HOUR, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBeNull();
    w.tick(R + 2 * HOUR + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(R + 2 * HOUR);
  });

  it("rescheduleForMin null keeps the tolerance", () => {
    const R = T + 3 * DAY;
    const a = task({ staleBaseAt: R, wasStale: true, rescheduleForMin: null });
    const w = world([a]);
    w.tick(R + 2 * HOUR + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBeNull();
    w.tick(R + DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(R + DAY);
  });

  it("a later change of the global alert period leaves a quick-duration stale moment alone (Edge Cases)", () => {
    const R = T + 3 * DAY;
    const a = task({ staleBaseAt: R, wasStale: true, rescheduleForMin: 120 });
    expect(applyPeriodChange([a], { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 10 * 1440 }, R + HOUR).upserts).toEqual([]);
    expect(staleMomentOf(a, { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 10 * 1440, rescheduleToleranceMin: 600 })).toBe(R + 2 * HOUR);
  });
});

describe("first-blink count (FR-017, FR-018)", () => {
  it("3 blinks when it goes stale while the main view is visible", () => {
    const a = task();
    const w = world([a]);
    const r = w.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).firstBlinkCount).toBe(3);
    expect(r.episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });

  it("1 blink when the stale moment is before the main view became visible", () => {
    const a = task();
    const w = world([a]);
    const r = w.tick(T + DAY + HOUR, { visible: true, visibleSince: T + DAY + 10_000 });
    expect(w.get(a.id).firstBlinkCount).toBe(1);
    expect(r.episodes).toEqual([{ id: a.id, blinks: 1 }]);
  });

  it("1 blink when detected while not visible, played on the next visible tick", () => {
    const a = task();
    const w = world([a]);
    expect(w.tick(T + DAY + 1, HIDDEN).episodes).toEqual([]);
    expect(w.get(a.id).firstBlinkCount).toBe(1);
    const r = w.tick(T + DAY + HOUR, { visible: true, visibleSince: T + DAY + HOUR });
    expect(r.episodes).toEqual([{ id: a.id, blinks: 1 }]);
  });

  it("upgrade case: a 30 h-old never-stale task on the first tick after launch (CHK024)", () => {
    const launch = T + 30 * HOUR;
    const a = task();
    const w = world([a]);
    const r = w.tick(launch, { visible: true, visibleSince: launch });
    expect(w.get(a.id)).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 1 });
    expect(r.episodes).toEqual([{ id: a.id, blinks: 1 }]);
  });
});

describe("episodes only while visible and only for shown rows (FR-021)", () => {
  it("plays nothing while not visible", () => {
    const a = task({ staleSince: T + DAY, wasStale: true, firstBlinkCount: 3 });
    expect(world([a]).tick(T + 2 * DAY, HIDDEN).episodes).toEqual([]);
  });

  it("plays nothing for a subtask whose parent is collapsed; plays its pending first episode once shown", () => {
    const p = task({ collapsed: true, createdAt: T + HOUR, staleBaseAt: T + HOUR });
    const s = task({ parentId: p.id });
    const w = world([p, s]);
    const r = w.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(r.episodes.find((e) => e.id === s.id)).toBeUndefined();
    expect(w.get(s.id).staleSince).toBe(T + DAY);
    w.set(w.rows().map((t) => (t.id === p.id ? { ...t, collapsed: false } : t)));
    const shown = w.tick(T + DAY + MIN, VISIBLE_SINCE_T);
    expect(shown.episodes.filter((e) => e.id === s.id)).toHaveLength(1);
  });

  it("a blink counts only when played: two hidden ticks, then a visible one, give one episode (CHK021)", () => {
    const a = task();
    const w = world([a]);
    w.tick(T + DAY + 1, HIDDEN);
    w.tick(T + DAY + HOUR, HIDDEN);
    expect(w.get(a.id).lastBlinkAt).toBeNull();
    const r = w.tick(T + DAY + 2 * HOUR, { visible: true, visibleSince: T + DAY + 2 * HOUR });
    expect(r.episodes).toEqual([{ id: a.id, blinks: 1 }]);
    expect(w.tick(T + DAY + 2 * HOUR + MIN, { visible: true, visibleSince: T + DAY + 2 * HOUR }).episodes).toEqual([]);
  });
});

describe("re-blinks (FR-019, CHK029)", () => {
  const S = T + DAY + 1;
  const stale = () => task({ staleSince: T + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: S });

  it("re-blinks 3 times at S + 4 h and S + 8 h, not before", () => {
    const a = stale();
    const w = world([a]);
    expect(w.tick(S + 4 * HOUR - MIN, VISIBLE_SINCE_T).episodes).toEqual([]);
    expect(w.tick(S + 4 * HOUR, VISIBLE_SINCE_T).episodes).toEqual([{ id: a.id, blinks: 3 }]);
    expect(w.tick(S + 6 * HOUR, VISIBLE_SINCE_T).episodes).toEqual([]);
    expect(w.tick(S + 8 * HOUR, VISIBLE_SINCE_T).episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });

  it("a re-blink missed while not visible plays once on return; the next counts from then", () => {
    const a = stale();
    const w = world([a]);
    expect(w.tick(S + 5 * HOUR, HIDDEN).episodes).toEqual([]);
    const back = { visible: true, visibleSince: S + 9 * HOUR };
    expect(w.tick(S + 9 * HOUR, back).episodes).toEqual([{ id: a.id, blinks: 3 }]);
    expect(w.tick(S + 12 * HOUR, back).episodes).toEqual([]);
    expect(w.tick(S + 13 * HOUR, back).episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });

  it("a 10-day forward jump gives one episode per row", () => {
    const a = stale();
    const b = stale();
    const r = world([a, b]).tick(S + 10 * DAY, VISIBLE_SINCE_T);
    expect(r.episodes).toEqual([
      { id: a.id, blinks: 3 },
      { id: b.id, blinks: 3 },
    ]);
  });

  it("every played row gets lastBlinkAt = now and keeps updatedAt (FR-044)", () => {
    const a = stale();
    const w = world([a]);
    w.tick(S + 4 * HOUR, VISIBLE_SINCE_T);
    expect(w.get(a.id)).toMatchObject({ lastBlinkAt: S + 4 * HOUR, updatedAt: T });
  });
});

describe("clock moved back (FR-045a)", () => {
  it("resets a last blink in the future to now; the next re-blink is one interval later", () => {
    const S = T + 3 * DAY;
    const a = task({ staleSince: T + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: S });
    const w = world([a]);
    const back = S - 2 * DAY;
    const r = w.tick(back, VISIBLE_SINCE_T);
    expect(r.episodes).toEqual([]);
    expect(w.get(a.id).lastBlinkAt).toBe(back);
    expect(w.tick(back + 4 * HOUR - MIN, VISIBLE_SINCE_T).episodes).toEqual([]);
    expect(w.tick(back + 4 * HOUR, VISIBLE_SINCE_T).episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });

  it("keeps a stale task stale when its stale moment is now in the future, without replaying its first blink", () => {
    const a = task({ staleSince: T + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: T + DAY + 1 });
    const w = world([a]);
    const r = w.tick(T + HOUR, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(T + DAY);
    expect(r.episodes).toEqual([]);
  });

  it("a countdown base in the future is simply not stale yet", () => {
    const a = task({ staleBaseAt: T + 5 * DAY, wasStale: true });
    expect(world([a]).tick(T + 2 * DAY, VISIBLE_SINCE_T).upserts).toEqual([]);
  });
});

describe("several tasks and subtasks (FR-005)", () => {
  it("several tasks crossing in one tick all become stale, each with its own episode", () => {
    const a = task();
    const b = task({ createdAt: T + 1000, staleBaseAt: T + 1000 });
    const r = world([a, b]).tick(T + DAY + 2000, VISIBLE_SINCE_T);
    expect(r.episodes).toEqual([
      { id: a.id, blinks: 3 },
      { id: b.id, blinks: 3 },
    ]);
  });

  it("subtasks go stale on their own, with their own override; the parent's override never applies", () => {
    const p = task({ alertOverrideMin: 7 * 1440 });
    const s = task({ parentId: p.id, createdAt: T + 10 * HOUR, staleBaseAt: T + 10 * HOUR });
    const w = world([p, s]);
    w.tick(T + 34 * HOUR + 1, VISIBLE_SINCE_T);
    expect(w.get(s.id).staleSince).toBe(T + 34 * HOUR);
    expect(w.get(p.id).staleSince).toBeNull();

    const p2 = task();
    const s2 = task({ parentId: p2.id, createdAt: T + 10 * HOUR, staleBaseAt: T + 10 * HOUR, alertOverrideMin: 120 });
    const w2 = world([p2, s2]);
    w2.tick(T + 12 * HOUR + 1, VISIBLE_SINCE_T);
    expect(w2.get(s2.id).staleSince).toBe(T + 12 * HOUR);
    expect(w2.get(p2.id).staleSince).toBeNull();
    w2.tick(T + DAY + 1, VISIBLE_SINCE_T);
    expect(w2.get(p2.id).staleSince).toBe(T + DAY);
  });

  it("works with a fake clock driving the times", () => {
    const clock = fakeClock(T);
    const a = task();
    const w = world([a]);
    clock.advance(DAY);
    expect(w.tick(clock.now(), VISIBLE_SINCE_T).upserts).toEqual([]);
    clock.advance(1);
    expect(w.tick(clock.now(), VISIBLE_SINCE_T).episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });
});

describe("settings changes apply at once (Story 7 scenarios 4–6, FR-009)", () => {
  it("global alert period 48 h → 24 h makes a 30 h-old task stale at once, 3 blinks; 24 h → 48 h leaves a stale task stale", () => {
    const a = task();
    const now = T + 30 * HOUR;
    const at48 = evaluateAlerts({ tasks: [a], settings: { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 2880 }, now, visibility: VISIBLE_SINCE_T });
    expect(at48.upserts).toEqual([]);
    const at24 = evaluateAlerts({ tasks: [a], settings: DEFAULT_ALERT_SETTINGS, now, visibility: VISIBLE_SINCE_T });
    expect(at24.upserts[0]).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 3 });

    const stale = at24.upserts[0] as Task;
    const back = evaluateAlerts({ tasks: [stale], settings: { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 2880 }, now: now + MIN, visibility: VISIBLE_SINCE_T });
    expect(back.upserts.find((t) => t.id === a.id)?.staleSince ?? stale.staleSince).toBe(T + DAY);
  });

  it("a tolerance change moves a rescheduled task's stale moment to reschedule time + the new tolerance", () => {
    const R = T + 3 * DAY;
    const a = task({ staleBaseAt: R, wasStale: true });
    const w = world([a], { ...DEFAULT_ALERT_SETTINGS, rescheduleToleranceMin: 120 });
    w.tick(R + 2 * HOUR + 1, VISIBLE_SINCE_T);
    expect(w.get(a.id).staleSince).toBe(R + 2 * HOUR);
  });

  it("a re-blink interval of 2 h instead of 4 h makes a task that last blinked 3 h ago re-blink at once; the next is 2 h later", () => {
    const S = T + DAY + 1;
    const a = task({ staleSince: T + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: S });
    const w = world([a], { ...DEFAULT_ALERT_SETTINGS, reblinkIntervalMin: 120 });
    expect(w.tick(S + 3 * HOUR, VISIBLE_SINCE_T).episodes).toEqual([{ id: a.id, blinks: 3 }]);
    expect(w.tick(S + 5 * HOUR - MIN, VISIBLE_SINCE_T).episodes).toEqual([]);
    expect(w.tick(S + 5 * HOUR, VISIBLE_SINCE_T).episodes).toEqual([{ id: a.id, blinks: 3 }]);
  });
});

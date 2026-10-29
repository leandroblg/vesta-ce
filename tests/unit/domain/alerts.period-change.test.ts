// 012 US2: what a change of the alert period does to a stale task (data-model "Un-stale rule" state table,
// research §10). Fake clock; one test per row of the table.
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from "../../../src/domain/alert-settings";
import { evaluateAlerts, unstaleIfAhead } from "../../../src/domain/alerts";
import { applyPeriodChange } from "../../../src/domain/period-change";
import type { Task } from "../../../src/domain/task";
import { budget } from "../perf-budget";
import { mk } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = 1_000_000_000;
const visible = { visible: true, visibleSince: T };

const settings = (alertPeriodMin: number): AlertSettings => ({ ...DEFAULT_ALERT_SETTINGS, alertPeriodMin });

/** Created 2 days before `now`, stale since 1 day after creation (24 h period), first blink played. */
function staleTask(overrides: Partial<Task> = {}): Task {
  return mk({
    createdAt: T,
    staleBaseAt: T,
    staleSince: T + DAY,
    wasStale: true,
    lastBlinkAt: T + DAY + MIN,
    firstBlinkCount: 3,
    updatedAt: T,
    ...overrides,
  });
}

const now = T + 2 * DAY;

describe("012 FR-026 unstaleIfAhead", () => {
  it("FR-026 stale from creation, new moment in the future: not stale, history kept, last edit unchanged", () => {
    const t = staleTask({ lastSignalAt: T + DAY + 2 * MIN });
    const back = unstaleIfAhead(t, settings(7 * 1440), now);
    expect(back).toEqual({ ...t, staleSince: null, lastBlinkAt: null, lastSignalAt: null, firstBlinkCount: null });
    expect(back?.wasStale).toBe(true);
    expect(back?.updatedAt).toBe(t.updatedAt);
  });

  it("FR-026 a moment that is not in the future keeps it stale", () => {
    // Exactly now: creation + 2 days.
    expect(unstaleIfAhead(staleTask(), settings(2 * 1440), now)).toBeNull();
  });

  it("FR-026 a new moment in the past keeps it stale", () => {
    expect(unstaleIfAhead(staleTask(), settings(30 * 60), now)).toBeNull();
  });

  it("FR-028 a rescheduled task, stale or not, is unchanged", () => {
    expect(unstaleIfAhead(staleTask({ staleBaseAt: T + HOUR }), settings(7 * 1440), now)).toBeNull();
    expect(unstaleIfAhead(staleTask({ staleBaseAt: T + HOUR, staleSince: null }), settings(7 * 1440), now)).toBeNull();
  });

  it("FR-028 a task that is not stale is unchanged (A4 rule 10 keeps applying through the tick)", () => {
    expect(unstaleIfAhead(staleTask({ staleSince: null }), settings(7 * 1440), now)).toBeNull();
  });

  it("FR-028 done and deleted tasks are unchanged", () => {
    expect(unstaleIfAhead(staleTask({ doneAt: now - HOUR }), settings(7 * 1440), now)).toBeNull();
    expect(unstaleIfAhead(staleTask({ deletedAt: now - HOUR }), settings(7 * 1440), now)).toBeNull();
  });
});

describe("012 FR-026 to FR-031 applyPeriodChange", () => {
  it("FR-026 a global change skips tasks with an override", () => {
    const plain = staleTask();
    const own = staleTask({ alertOverrideMin: 1440 });
    const { upserts } = applyPeriodChange([plain, own], settings(7 * 1440), now);
    expect(upserts.map((t) => t.id)).toEqual([plain.id]);
  });

  it("FR-026 an override change touches only the changed task", () => {
    const a = staleTask({ alertOverrideMin: 7 * 1440 });
    const b = staleTask();
    const { upserts } = applyPeriodChange([a, b], settings(7 * 1440), now, new Set([a.id]));
    expect(upserts.map((t) => t.id)).toEqual([a.id]);
  });

  it("FR-029 an auto-sorted pinned task moves to the top of the non-pinned top-level tasks", () => {
    const pinned = staleTask({ position: 5 });
    const plain1 = mk({ createdAt: now - HOUR, position: 1 });
    const plain2 = mk({ createdAt: now - HOUR, position: 2 });
    const [moved] = applyPeriodChange([pinned, plain1, plain2], settings(7 * 1440), now).upserts;
    expect(moved?.staleSince).toBeNull();
    expect(moved?.position).toBeLessThan(1);
    expect(moved?.updatedAt).toBe(pinned.updatedAt);
  });

  it("FR-029 several un-staled tasks keep their stale-group order (oldest on top)", () => {
    const older = staleTask({ createdAt: T - HOUR, staleBaseAt: T - HOUR, staleSince: T + DAY - HOUR, position: 9 });
    const newer = staleTask({ position: 3 });
    const plain = mk({ createdAt: now - HOUR, position: 1 });
    const rows = new Map(applyPeriodChange([newer, older, plain], settings(7 * 1440), now).upserts.map((t) => [t.id, t]));
    const o = rows.get(older.id) as Task;
    const n = rows.get(newer.id) as Task;
    expect(o.position).toBeLessThan(n.position);
    expect(n.position).toBeLessThan(plain.position);
  });

  it("FR-029 a manually positioned task keeps its position", () => {
    const manual = staleTask({ position: 5, manuallyPositioned: true });
    const plain = mk({ createdAt: now - HOUR, position: 1 });
    const [back] = applyPeriodChange([manual, plain], settings(7 * 1440), now).upserts;
    expect(back?.position).toBe(5);
    expect(back?.staleSince).toBeNull();
  });

  it("FR-028a a subtask is evaluated on its own: a stale parent stays stale, and the reverse", () => {
    const parent = staleTask({ alertOverrideMin: 1440 });
    const child = staleTask({ parentId: parent.id });
    const out = applyPeriodChange([parent, child], settings(7 * 1440), now).upserts;
    expect(out.map((t) => t.id)).toEqual([child.id]);
    const parent2 = staleTask();
    const child2 = staleTask({ parentId: parent2.id, alertOverrideMin: 1440 });
    const out2 = applyPeriodChange([parent2, child2], settings(7 * 1440), now).upserts;
    expect(out2.map((t) => t.id)).toEqual([parent2.id]);
  });

  it("FR-028b a task with its first blink still pending un-stales with no blink", () => {
    const pending = staleTask({ lastBlinkAt: null });
    const [back] = applyPeriodChange([pending], settings(7 * 1440), now).upserts;
    const tick = evaluateAlerts({ tasks: [back as Task], settings: settings(7 * 1440), now: now + MIN, visibility: visible });
    expect(tick.episodes).toEqual([]);
    expect(tick.upserts).toEqual([]);
  });

  it("FR-027 the tick makes it stale again at the new moment, with 3 blinks", () => {
    const s = settings(7 * 1440);
    const [back] = applyPeriodChange([staleTask()], s, now).upserts;
    const moment = T + 7 * DAY;
    const before = evaluateAlerts({ tasks: [back as Task], settings: s, now: moment, visibility: visible });
    expect(before.upserts).toEqual([]);
    const after = evaluateAlerts({ tasks: [back as Task], settings: s, now: moment + 1, visibility: visible });
    const [stale] = after.upserts;
    expect(stale?.staleSince).toBe(moment);
    expect(stale?.firstBlinkCount).toBe(3);
    expect(after.episodes).toEqual([{ id: back?.id, blinks: 3 }]);
  });

  it("FR-027 A4 rule 9: a hidden subtask going stale again signals its collapsed parent once", () => {
    const s = settings(7 * 1440);
    const parent = mk({ createdAt: now - HOUR, collapsed: true, alertOverrideMin: 30 * 1440 });
    const child = staleTask({ parentId: parent.id });
    const [back] = applyPeriodChange([parent, child], s, now).upserts;
    const moment = T + 7 * DAY;
    const tick1 = evaluateAlerts({ tasks: [parent, back as Task], settings: s, now: moment + 1, visibility: visible });
    expect(tick1.episodes).toEqual([{ id: parent.id, blinks: 1 }]);
    const rows = new Map([[parent.id, parent], ...tick1.upserts.map((t): [string, Task] => [t.id, t])]);
    const tick2 = evaluateAlerts({ tasks: [...rows.values()], settings: s, now: moment + 2, visibility: visible });
    expect(tick2.episodes).toEqual([]);
  });

  it("Edge Cases two changes in a row: a longer period un-stales, a shorter one already past makes it stale at the next tick with 3 blinks", () => {
    const [back] = applyPeriodChange([staleTask()], settings(7 * 1440), now).upserts;
    const shorter = settings(1440);
    // The shorter period's moment is past, so nothing un-stales; the task is simply not stale yet.
    expect(applyPeriodChange([back as Task], shorter, now).upserts).toEqual([]);
    const tick = evaluateAlerts({ tasks: [back as Task], settings: shorter, now, visibility: visible });
    expect(tick.upserts[0]?.staleSince).toBe(T + DAY);
    expect(tick.episodes).toEqual([{ id: back?.id, blinks: 3 }]);
  });
});

describe("012 plan Performance Goals", () => {
  it("applyPeriodChange over 1,000 tasks stays under 20 ms", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      i % 3 === 0 ? staleTask({ position: i }) : mk({ createdAt: now - HOUR, position: i }),
    );
    applyPeriodChange(rows, settings(7 * 1440), now);
    const t0 = performance.now();
    const n = 10;
    for (let i = 0; i < n; i++) applyPeriodChange(rows, settings(7 * 1440), now);
    const ms = (performance.now() - t0) / n;
    console.info(`[012 T072] applyPeriodChange over 1,000 tasks: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(budget(20));
  });
});

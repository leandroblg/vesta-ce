/** Restored tasks and the stale state (003 FR-018 exception, FR-028; T040). */
import { describe, expect, it } from "vitest";
import { markDone, restore } from "../../../src/domain/actions";
import { applyUndo } from "../../../src/domain/undo";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { staleOnReturn } from "../../../src/domain/alerts";
import { fixedClock } from "../../../src/domain/clock";
import type { Task } from "../../../src/domain/task";
import { mk } from "./fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T = 1_000_000_000_000;
const get = (cs: { upserts: Task[] }, id: string) => cs.upserts.find((t) => t.id === id) as Task;

describe("staleOnReturn", () => {
  it("makes a row past its threshold stale with the real crossing moment and 3 blinks", () => {
    const a = mk({ createdAt: T });
    const [back] = staleOnReturn([a], DEFAULT_ALERT_SETTINGS, T + 3 * DAY);
    expect(back).toMatchObject({ staleSince: T + DAY, wasStale: true, firstBlinkCount: 3 });
  });

  it("leaves a row not past its threshold, and an already-stale row, unchanged", () => {
    const young = mk({ createdAt: T });
    const stale = mk({ createdAt: T, staleSince: T + DAY, wasStale: true, firstBlinkCount: 1, lastBlinkAt: T + DAY + 1 });
    expect(staleOnReturn([young, stale], DEFAULT_ALERT_SETTINGS, T + HOUR)).toEqual([young, stale]);
    expect(staleOnReturn([stale], DEFAULT_ALERT_SETTINGS, T + 5 * DAY)).toEqual([stale]);
  });
});

describe("restore with alert settings (FR-018, FR-028)", () => {
  it("a non-stale task done at T + 2 h and restored at T + 3 d comes back stale at T + 24 h, 3 blinks", () => {
    const a = mk({ createdAt: T, doneAt: T + 2 * HOUR });
    const cs = restore(a.id, [a], fixedClock(T + 3 * DAY), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, a.id)).toMatchObject({ doneAt: null, staleSince: T + DAY, firstBlinkCount: 3, wasStale: true });
  });

  it("evaluates the subtasks restored with their parent too", () => {
    const p = mk({ createdAt: T + 2 * DAY, doneAt: T + 2 * DAY + HOUR });
    const s = mk({ parentId: p.id, createdAt: T, doneAt: T + 2 * DAY + HOUR, leftWithId: p.id });
    const cs = restore(p.id, [p, s], fixedClock(T + 2 * DAY + 2 * HOUR), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, p.id).staleSince).toBeNull();
    expect(get(cs, s.id)).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 3 });
  });

  it("a stale top-level task comes back with its manual mark cleared, still stale", () => {
    const a = mk({ createdAt: T, staleSince: T + DAY, wasStale: true, manuallyPositioned: true, doneAt: T + 2 * DAY });
    const cs = restore(a.id, [a], fixedClock(T + 3 * DAY), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, a.id)).toMatchObject({ staleSince: T + DAY, manuallyPositioned: false });
  });

  it("a stale subtask restored under its active parent keeps the 001 placement and stays stale", () => {
    const p = mk({ position: 1 });
    const s = mk({ parentId: p.id, position: 2, createdAt: T, staleSince: T + DAY, wasStale: true, doneAt: T + 2 * DAY });
    const cs = restore(s.id, [p, s], fixedClock(T + 3 * DAY), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, s.id)).toMatchObject({ parentId: p.id, staleSince: T + DAY });
  });

  it("leaves rows that were already active alone, even when bringBack touches them", () => {
    const p = mk({ collapsed: true, createdAt: T, staleSince: T + DAY, wasStale: true, manuallyPositioned: true });
    const s = mk({ parentId: p.id, createdAt: T + 2 * DAY, doneAt: T + 2 * DAY + HOUR });
    const cs = restore(s.id, [p, s], fixedClock(T + 3 * DAY), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, p.id)).toMatchObject({ collapsed: false, manuallyPositioned: true });
  });

  it("a stale subtask whose parent is gone comes back top-level, with no manual mark (pinned)", () => {
    const p = mk({ deletedAt: T + DAY });
    const s = mk({ parentId: p.id, createdAt: T, staleSince: T + DAY, wasStale: true, manuallyPositioned: true, doneAt: T + 2 * DAY });
    const cs = restore(s.id, [p, s], fixedClock(T + 3 * DAY), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, s.id)).toMatchObject({ parentId: null, staleSince: T + DAY, manuallyPositioned: false });
  });

  it("a stale subtask restored with its collapsed parent is shown: 3 blinks, no parent signal (FR-028a)", () => {
    const p = mk({ collapsed: true, createdAt: T + 2 * DAY, doneAt: T + 2 * DAY + HOUR });
    const s = mk({ parentId: p.id, createdAt: T, doneAt: T + 2 * DAY + HOUR, leftWithId: p.id });
    const cs = restore(p.id, [p, s], fixedClock(T + 2 * DAY + 2 * HOUR), DEFAULT_ALERT_SETTINGS);
    expect(get(cs, p.id).collapsed).toBe(false);
    expect(get(cs, s.id)).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 3, lastSignalAt: null });
  });

  it("undo of a collapsed parent's done brings it back collapsed (not a restore)", () => {
    const p = mk({ collapsed: true });
    const s = mk({ parentId: p.id });
    const done = markDone(p.id, [p, s], fixedClock(T));
    const back = applyUndo({ kind: "done", before: [p, s] }, done.upserts, fixedClock(T + 1));
    expect(back.upserts.find((t) => t.id === p.id)?.collapsed).toBe(true);
  });
});

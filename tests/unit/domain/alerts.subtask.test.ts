/** Collapsed parents signal their hidden stale subtasks (003 FR-021a, Q100; T058). */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { evaluateAlerts, type Episode, type Visibility } from "../../../src/domain/alerts";
import type { Task } from "../../../src/domain/task";
import { mk } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = 1_000_000_000_000;
const VIS: Visibility = { visible: true, visibleSince: T };
const HIDDEN: Visibility = { visible: false, visibleSince: T };

function world(tasks: Task[]) {
  let rows = tasks;
  return {
    tick(now: number, visibility: Visibility = VIS): Episode[] {
      const r = evaluateAlerts({ tasks: rows, settings: DEFAULT_ALERT_SETTINGS, now, visibility });
      const byId = new Map(r.upserts.map((u) => [u.id, u]));
      rows = rows.map((t) => byId.get(t.id) ?? t);
      return r.episodes;
    },
    get: (id: string) => rows.find((t) => t.id === id) as Task,
    setCollapsed(id: string, collapsed: boolean) {
      rows = rows.map((t) => (t.id === id ? { ...t, collapsed } : t));
    },
  };
}

/** A parent created much later (never stale in these tests) with one subtask created at T. */
function family(collapsed: boolean, extra: Partial<Task> = {}) {
  const parent = mk({ createdAt: T + 30 * DAY, staleBaseAt: T + 30 * DAY, collapsed, ...extra });
  const sub = mk({ parentId: parent.id, createdAt: T, staleBaseAt: T });
  return { parent, sub };
}

describe("hidden subtask going stale (FR-021a)", () => {
  it("the collapsed parent blinks once; the subtask does not; its first episode will be 1 blink", () => {
    const { parent, sub } = family(true);
    const w = world([parent, sub]);
    expect(w.tick(T + DAY + 1)).toEqual([{ id: parent.id, blinks: 1 }]);
    expect(w.get(sub.id)).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 1, lastSignalAt: T + DAY + 1, lastBlinkAt: null });
    expect(w.get(parent.id)).toEqual(parent);
  });

  it("re-blinks as a parent signal every interval while hidden, never piling up", () => {
    const { parent, sub } = family(true);
    const w = world([parent, sub]);
    const S = T + DAY + 1;
    w.tick(S);
    expect(w.tick(S + 4 * HOUR - MIN)).toEqual([]);
    expect(w.tick(S + 4 * HOUR)).toEqual([{ id: parent.id, blinks: 1 }]);
    expect(w.tick(S + 5 * HOUR, HIDDEN)).toEqual([]);
    expect(w.tick(S + 10 * DAY)).toEqual([{ id: parent.id, blinks: 1 }]);
    expect(w.tick(S + 10 * DAY + MIN)).toEqual([]);
  });

  it("on expand, plays the subtask's pending first blink once (1 blink), then counts re-blinks from the later of blink and signal", () => {
    const { parent, sub } = family(true);
    const w = world([parent, sub]);
    const S = T + DAY + 1;
    w.tick(S);
    w.tick(S + 4 * HOUR); // a second signal
    w.setCollapsed(parent.id, false);
    expect(w.tick(S + 5 * HOUR)).toEqual([{ id: sub.id, blinks: 1 }]);
    expect(w.tick(S + 5 * HOUR + MIN)).toEqual([]);
    expect(w.tick(S + 9 * HOUR - MIN)).toEqual([]);
    expect(w.tick(S + 9 * HOUR)).toEqual([{ id: sub.id, blinks: 3 }]);
  });

  it("on expand after the first blink already played, nothing plays until the next re-blink", () => {
    const { parent, sub } = family(false);
    const w = world([parent, sub]);
    const S = T + DAY + 1;
    expect(w.tick(S)).toEqual([{ id: sub.id, blinks: 3 }]);
    w.setCollapsed(parent.id, true);
    expect(w.tick(S + HOUR)).toEqual([]); // collapsing never makes the parent blink by itself
    w.setCollapsed(parent.id, false);
    expect(w.tick(S + 2 * HOUR)).toEqual([]);
  });

  it("collapsing after the first blink: the next re-blink comes as a parent signal", () => {
    const { parent, sub } = family(false);
    const w = world([parent, sub]);
    const S = T + DAY + 1;
    w.tick(S);
    w.setCollapsed(parent.id, true);
    expect(w.tick(S + 4 * HOUR - MIN)).toEqual([]);
    expect(w.tick(S + 4 * HOUR)).toEqual([{ id: parent.id, blinks: 1 }]);
  });

  it("collapsing before the first blink played (stale while out of sight): the parent signals at the first visible tick; expand plays 1 blink", () => {
    const { parent, sub } = family(false);
    const w = world([parent, sub]);
    w.tick(T + DAY + 1, HIDDEN);
    expect(w.get(sub.id).firstBlinkCount).toBe(1);
    w.setCollapsed(parent.id, true);
    const back = { visible: true, visibleSince: T + DAY + HOUR };
    expect(w.tick(T + DAY + HOUR, back)).toEqual([{ id: parent.id, blinks: 1 }]);
    w.setCollapsed(parent.id, false);
    expect(w.tick(T + DAY + 2 * HOUR, back)).toEqual([{ id: sub.id, blinks: 1 }]);
  });
});

describe("expanded parents never signal (FR-021a)", () => {
  it("a subtask going stale under an expanded parent: 3 blinks on the subtask, none on the parent, also at re-blinks", () => {
    const { parent, sub } = family(false);
    const w = world([parent, sub]);
    const S = T + DAY + 1;
    expect(w.tick(S)).toEqual([{ id: sub.id, blinks: 3 }]);
    expect(w.get(sub.id).firstBlinkCount).toBe(3);
    expect(w.tick(S + 4 * HOUR)).toEqual([{ id: sub.id, blinks: 3 }]);
    expect(w.get(sub.id).lastSignalAt).toBeNull();
  });
});

describe("shared and overlapping signals", () => {
  it("two hidden subtasks due in one tick: one parent episode; both get lastSignalAt", () => {
    const { parent, sub } = family(true);
    const sub2 = mk({ parentId: parent.id, createdAt: T + 1000, staleBaseAt: T + 1000 });
    const w = world([parent, sub, sub2]);
    expect(w.tick(T + DAY + 2000)).toEqual([{ id: parent.id, blinks: 1 }]);
    expect(w.get(sub.id).lastSignalAt).toBe(T + DAY + 2000);
    expect(w.get(sub2.id).lastSignalAt).toBe(T + DAY + 2000);
  });

  it("a stale collapsed parent whose own episode plays in the same tick plays only its own; the signal counts as given", () => {
    const parent = mk({ createdAt: T, staleBaseAt: T, collapsed: true });
    const sub = mk({ parentId: parent.id, createdAt: T + 1000, staleBaseAt: T + 1000 });
    const w = world([parent, sub]);
    expect(w.tick(T + DAY + 2000)).toEqual([{ id: parent.id, blinks: 3 }]);
    expect(w.get(sub.id).lastSignalAt).toBe(T + DAY + 2000);
    expect(w.get(parent.id).lastBlinkAt).toBe(T + DAY + 2000);
  });

  it("a signal never changes a stale parent's own re-blink schedule", () => {
    const parent = mk({ createdAt: T, staleBaseAt: T, collapsed: true, staleSince: T + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: T + DAY });
    const sub = mk({ parentId: parent.id, createdAt: T + 2 * HOUR, staleBaseAt: T + 2 * HOUR });
    const w = world([parent, sub]);
    expect(w.tick(T + DAY + 2 * HOUR + 1)).toEqual([{ id: parent.id, blinks: 1 }]);
    expect(w.get(parent.id).lastBlinkAt).toBe(T + DAY);
    expect(w.tick(T + DAY + 4 * HOUR)).toEqual([{ id: parent.id, blinks: 3 }]);
  });
});

describe("out of sight, clock back, no edits", () => {
  it("a hidden subtask going stale while not visible: no episode; the first visible tick (even after a restart) plays the parent's 1 blink", () => {
    const { parent, sub } = family(true);
    const w = world([parent, sub]);
    expect(w.tick(T + DAY + 1, HIDDEN)).toEqual([]);
    expect(w.get(sub.id).lastSignalAt).toBeNull();
    expect(w.tick(T + DAY + HOUR, { visible: true, visibleSince: T + DAY + HOUR })).toEqual([{ id: parent.id, blinks: 1 }]);
  });

  it("resets a lastSignalAt in the future to now", () => {
    const { parent, sub } = family(true);
    const staleSub = { ...sub, staleSince: T + DAY, wasStale: true, firstBlinkCount: 1 as const, lastSignalAt: T + 5 * DAY };
    const w = world([parent, staleSub]);
    w.tick(T + 2 * DAY);
    expect(w.get(sub.id).lastSignalAt).toBe(T + 2 * DAY);
  });

  it("every row a signal touches keeps its updatedAt (FR-044)", () => {
    const { parent, sub } = family(true);
    const w = world([parent, sub]);
    w.tick(T + DAY + 1);
    expect(w.get(sub.id).updatedAt).toBe(sub.updatedAt);
    expect(w.get(parent.id).updatedAt).toBe(parent.updatedAt);
  });
});

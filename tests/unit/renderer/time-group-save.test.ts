// 018 FR-037 (PRD Q288, Q289; research §16): a group of time fields saves when the focus leaves the group, on Enter,
// or 2 s after the last keystroke or move between its fields; never on a move alone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushAll } from "../../../src/renderer/store/flush";
import { TIME_GROUP_DEBOUNCE_MS, createTimeGroupSaver, type SaveHow } from "../../../src/renderer/features/settings/useTimeGroupSave";

describe("createTimeGroupSaver", () => {
  let saved: [number, SaveHow][];
  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const saver = () =>
    createTimeGroupSaver<number>((v, how) => {
      saved.push([v, how]);
    });

  it("waits 2 s after the last offer, not 1999 ms", () => {
    expect(TIME_GROUP_DEBOUNCE_MS).toBe(2000);
    const s = saver();
    s.offer(1);
    vi.advanceTimersByTime(1000);
    s.offer(12);
    vi.advanceTimersByTime(1999);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual([[12, "idle"]]);
  });

  it("a move to another field of the group restarts the wait and saves nothing, at any time", () => {
    const s = saver();
    s.offer(5);
    vi.advanceTimersByTime(1500);
    s.moved();
    vi.advanceTimersByTime(1999);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(saved).toEqual([[5, "idle"]]);
  });

  it("leaving the group saves at once and nothing later; so does Enter", () => {
    const s = saver();
    s.offer(3);
    s.left();
    expect(saved).toEqual([[3, "leave"]]);
    vi.advanceTimersByTime(5000);
    expect(saved).toHaveLength(1);
    s.offer(4);
    s.enter();
    expect(saved).toEqual([
      [3, "leave"],
      [4, "enter"],
    ]);
  });

  it("closing (unmount) and quitting save a pending value; a cancelled one saves nothing", async () => {
    const s = saver();
    s.offer(7);
    s.close();
    expect(saved).toEqual([[7, "close"]]);
    const q = saver();
    q.offer(8);
    await flushAll();
    expect(saved).toEqual([
      [7, "close"],
      [8, "close"],
    ]);
    const c = saver();
    c.offer(9);
    c.cancel();
    c.left();
    vi.advanceTimersByTime(5000);
    expect(saved).toHaveLength(2);
  });

  it("with nothing pending, a move, leaving or Enter saves nothing", () => {
    const s = saver();
    s.moved();
    s.left();
    s.enter();
    vi.advanceTimersByTime(5000);
    expect(saved).toEqual([]);
    expect(s.pending()).toBe(false);
  });
});

// 018 FR-020a, FR-037 (PRD Q282, Q287, Q288, Q289; research §8, §16): when the cleanup fields send a time, and
// whether as a commit that may ask the confirmation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCleanupFieldsLogic, type CleanupSend } from "../../../src/renderer/features/settings/cleanup-fields-logic";
import { flushAll } from "../../../src/renderer/store/flush";

type Reply = { saved: boolean; pending: boolean } | null;

describe("createCleanupFieldsLogic", () => {
  let calls: [number, boolean][];
  let reply: Reply;
  let resets: number;
  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    reply = { saved: true, pending: false };
    resets = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const send: CleanupSend = (hours, commit) => {
    calls.push([hours, commit]);
    return Promise.resolve(reply);
  };
  const logic = () =>
    createCleanupFieldsLogic(send, () => {
      resets += 1;
    });

  it("a valid total goes uncommitted 2 s after the last input, not before; a move between fields restarts the wait", () => {
    const l = logic();
    l.typed(5);
    vi.advanceTimersByTime(1500);
    l.moved();
    vi.advanceTimersByTime(1999);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([[5, false]]);
  });

  it("after a pending reply, leaving the group or Enter sends it committed; without one leaving sends nothing", async () => {
    reply = { saved: false, pending: true };
    const l = logic();
    l.typed(8);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual([[8, false]]);
    l.left();
    expect(calls).toEqual([
      [8, false],
      [8, true],
    ]);
    reply = { saved: true, pending: false };
    const m = logic();
    m.typed(9);
    await vi.advanceTimersByTimeAsync(2000);
    m.left();
    expect(calls.slice(2)).toEqual([[9, false]]);
  });

  it("leaving the group or Enter within the wait sends once, committed, and nothing later", () => {
    const l = logic();
    l.typed(3);
    vi.advanceTimersByTime(200);
    l.enter();
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual([[3, true]]);
  });

  it("closing 300 ms after typing sends the value uncommitted (never lost); closing after a pending reply sends nothing", async () => {
    const l = logic();
    l.typed(12);
    vi.advanceTimersByTime(300);
    l.close();
    expect(calls).toEqual([[12, false]]);
    reply = { saved: false, pending: true };
    const p = logic();
    p.typed(1);
    await vi.advanceTimersByTimeAsync(2000);
    p.close();
    expect(calls).toEqual([
      [12, false],
      [1, false],
    ]);
  });

  it("quitting sends a value still in its wait", async () => {
    const l = logic();
    l.typed(40);
    await flushAll();
    expect(calls).toEqual([[40, false]]);
  });

  it("a zero total sends nothing; a committed reply not saved resets the fields", async () => {
    const l = logic();
    l.typed("min");
    l.left();
    vi.advanceTimersByTime(5000);
    expect(calls).toEqual([]);
    reply = { saved: false, pending: false };
    l.typed(6);
    l.enter();
    await vi.runAllTimersAsync();
    expect(resets).toBe(1);
  });
});

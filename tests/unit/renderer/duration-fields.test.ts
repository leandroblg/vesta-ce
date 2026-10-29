// 012 FR-026a (PRD Q159, Q163): the debounce helper; a pending value is
// applied at once when the fields close or before quitting (flushAll). From 018 (Q288) DurationFields uses useTimeGroupSave.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebounced } from "../../../src/renderer/features/settings/debounced";
import { flushAll } from "../../../src/renderer/store/flush";

describe("012 FR-026a createDebounced", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("FR-026a typing 1 then 10 within 500 ms applies once, 500 ms after the last keystroke", () => {
    const apply = vi.fn();
    const d = createDebounced<number>(500, apply);
    d.offer(1 * 1440);
    vi.advanceTimersByTime(300);
    d.offer(10 * 1440);
    vi.advanceTimersByTime(499);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(10 * 1440);
    expect(d.pending()).toBe(false);
  });

  it("FR-026a closing the fields with a value pending applies it at once", () => {
    const apply = vi.fn();
    const d = createDebounced<number>(500, apply);
    d.offer(600);
    d.flush();
    expect(apply).toHaveBeenCalledWith(600);
    vi.advanceTimersByTime(1000);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("FR-026a flushAll before quitting applies a pending value; nothing is registered once applied", async () => {
    const apply = vi.fn();
    const d = createDebounced<number>(500, apply);
    d.offer(720);
    await flushAll();
    expect(apply).toHaveBeenCalledWith(720);
    await flushAll();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("FR-026a typing back the saved value cancels the pending one", () => {
    const apply = vi.fn();
    const d = createDebounced<number>(500, apply);
    d.offer(600);
    d.cancel();
    vi.advanceTimersByTime(1000);
    d.flush();
    expect(apply).not.toHaveBeenCalled();
  });

  it("T077 cancelling a pending value (the fields disabled by Use global default) means it never applies, also through flushAll", async () => {
    const apply = vi.fn();
    const d = createDebounced<number>(500, apply);
    d.offer(15 * 1440);
    d.cancel();
    await flushAll();
    vi.advanceTimersByTime(1000);
    expect(apply).not.toHaveBeenCalled();
  });
});

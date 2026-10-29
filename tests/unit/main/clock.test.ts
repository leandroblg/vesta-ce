import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppClock, type ClockHook } from "../../../src/main/clock";

describe("app clock (003 research §8)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("packaged builds use the system clock and ignore VESTA_CLOCK_OFFSET_MIN", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const register = vi.fn();
    const { clock, issues } = createAppClock({ isPackaged: true, env: { VESTA_CLOCK_OFFSET_MIN: "1500" }, register });
    expect(clock.now()).toBe(1_000_000);
    expect(register).not.toHaveBeenCalled();
    expect(issues).toEqual([]);
  });

  it("unpackaged builds shift the clock by VESTA_CLOCK_OFFSET_MIN minutes", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { clock } = createAppClock({ isPackaged: false, env: { VESTA_CLOCK_OFFSET_MIN: "1500" }, register: () => undefined });
    expect(clock.now()).toBe(1_000_000 + 90_000_000);
  });

  it("ignores and reports an invalid offset", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    for (const bad of ["abc", "-5", "1.5", ""]) {
      const { clock, issues } = createAppClock({ isPackaged: false, env: { VESTA_CLOCK_OFFSET_MIN: bad }, register: () => undefined });
      expect(clock.now()).toBe(1_000_000);
      expect(issues).toEqual(bad === "" ? [] : [`VESTA_CLOCK_OFFSET_MIN=${bad} ignored`]);
    }
  });

  it("unpackaged builds register a hook that moves the clock forward or sets it, backwards too", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    let hook: ClockHook | null = null;
    const { clock } = createAppClock({
      isPackaged: false,
      env: {},
      register: (h) => {
        hook = h;
      },
    });
    expect(hook).not.toBeNull();
    (hook as unknown as ClockHook).advance(5000);
    expect(clock.now()).toBe(1_005_000);
    vi.advanceTimersByTime(1000);
    expect(clock.now()).toBe(1_006_000);
    (hook as unknown as ClockHook).set(500);
    expect(clock.now()).toBe(500);
    vi.advanceTimersByTime(100);
    expect(clock.now()).toBe(600);
  });

  it("a packaged clock never defines globalThis.__vestaClock (contracts/ipc.md)", () => {
    const g = globalThis as { __vestaClock?: unknown };
    delete g.__vestaClock;
    createAppClock({
      isPackaged: true,
      env: {},
      register: (h) => {
        g.__vestaClock = h;
      },
    });
    expect(g.__vestaClock).toBeUndefined();
  });
});

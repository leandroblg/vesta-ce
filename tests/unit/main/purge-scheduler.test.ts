import { describe, expect, it } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { PURGE_INTERVAL_MS, startPurgeScheduler } from "../../../src/main/purge-scheduler";

function fakeTimer() {
  let fn: (() => void) | null = null;
  let ms = 0;
  return {
    timer: {
      setInterval: (f: () => void, interval: number) => {
        fn = f;
        ms = interval;
        return 1;
      },
      clearInterval: () => {
        fn = null;
      },
    },
    fire: () => fn?.(),
    interval: () => ms,
    active: () => fn !== null,
  };
}

const quietLog = { fatal: () => undefined, error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined, trace: () => undefined };

describe("purge scheduler (FR-035)", () => {
  it("runs at start and then every 60 minutes, sending the removed ids", () => {
    const clock = fakeClock(1000);
    const t = fakeTimer();
    const runs: number[] = [];
    const sent: string[][] = [];
    const stop = startPurgeScheduler({
      clock,
      timer: t.timer,
      purge: (now) => {
        runs.push(now);
        return runs.length === 1 ? ["a", "b"] : [];
      },
      onPurged: (ids) => sent.push(ids),
      log: quietLog,
    });
    expect(runs).toEqual([1000]);
    expect(sent).toEqual([["a", "b"]]);
    expect(t.interval()).toBe(PURGE_INTERVAL_MS);
    expect(PURGE_INTERVAL_MS).toBe(3_600_000);
    clock.advance(PURGE_INTERVAL_MS);
    t.fire();
    expect(runs).toEqual([1000, 1000 + PURGE_INTERVAL_MS]);
    expect(sent).toHaveLength(1); // nothing sent when nothing was removed
    stop();
    expect(t.active()).toBe(false);
  });

  it("018 T066: with a shown signal, the start run waits for it and the hourly timer still starts at once", () => {
    const clock = fakeClock(1000);
    const t = fakeTimer();
    const runs: number[] = [];
    const shown: (() => void)[] = [];
    startPurgeScheduler({
      clock,
      timer: t.timer,
      purge: (now) => {
        runs.push(now);
        return [];
      },
      onPurged: () => undefined,
      log: quietLog,
      afterShown: (fn) => {
        shown.push(fn);
      },
    });
    expect(runs).toEqual([]);
    expect(t.interval()).toBe(PURGE_INTERVAL_MS);
    clock.advance(300);
    for (const fn of shown) fn();
    expect(runs).toEqual([1300]);
  });

  it("logs a failed run and retries at the next one", () => {
    const clock = fakeClock(0);
    const t = fakeTimer();
    const errors: string[] = [];
    let attempt = 0;
    startPurgeScheduler({
      clock,
      timer: t.timer,
      purge: () => {
        attempt += 1;
        if (attempt === 1) throw new Error("disk is full");
        return ["x"];
      },
      onPurged: () => undefined,
      log: { ...quietLog, error: (event: string) => errors.push(event) },
    });
    expect(errors).toEqual(["purge.failed"]);
    t.fire();
    expect(attempt).toBe(2);
  });
});

describe("purge scheduler and the operation gate (008 FR-050, FR-037c, FR-039)", () => {
  it("does not purge while an operation runs, then purges once when the gate is idle", async () => {
    const { OperationGate } = await import("../../../src/main/operation-gate");
    const clock = fakeClock(1000);
    const t = fakeTimer();
    const gate = new OperationGate();
    gate.tryBegin("import");
    const runs: number[] = [];
    startPurgeScheduler({
      clock,
      timer: t.timer,
      purge: (now) => {
        runs.push(now);
        return ["imported-trash-past-30-days"];
      },
      onPurged: () => undefined,
      log: quietLog,
      gate,
    });
    expect(runs).toEqual([]);
    clock.advance(PURGE_INTERVAL_MS);
    t.fire();
    expect(runs).toEqual([]);
    clock.advance(5);
    gate.end();
    expect(runs).toEqual([1000 + PURGE_INTERVAL_MS + 5]); // once, at the time the gate went idle
  });

  it("keeps the 001 timing when the gate stays idle", async () => {
    const { OperationGate } = await import("../../../src/main/operation-gate");
    const clock = fakeClock(1000);
    const t = fakeTimer();
    const runs: number[] = [];
    startPurgeScheduler({ clock, timer: t.timer, purge: (now) => (runs.push(now), []), onPurged: () => undefined, log: quietLog, gate: new OperationGate() });
    clock.advance(PURGE_INTERVAL_MS);
    t.fire();
    expect(runs).toEqual([1000, 1000 + PURGE_INTERVAL_MS]);
  });
});

describe("018 the cleanups' run (FR-017, FR-018, FR-020b; research §6)", () => {
  it("logs purge.removed once with the count by cleanup, and nothing when nothing went", () => {
    const clock = fakeClock(1000);
    const t = fakeTimer();
    const infos: [string, unknown][] = [];
    let n = 0;
    startPurgeScheduler({
      clock,
      timer: t.timer,
      purge: () => (n++ === 0 ? { ids: ["a", "b", "c"], archive: 2, trash: 1 } : { ids: [], archive: 0, trash: 0 }),
      onPurged: () => undefined,
      log: { ...quietLog, info: (event: string, data?: unknown) => infos.push([event, data]) },
    });
    t.fire();
    expect(infos).toEqual([["purge.removed", { count: 3, archive: 2, trash: 1 }]]);
  });

  it("calls the purge with the time of each run, so settings read in it are the current ones", () => {
    const clock = fakeClock(1000);
    const t = fakeTimer();
    let hours = 720;
    const seen: number[] = [];
    startPurgeScheduler({
      clock,
      timer: t.timer,
      purge: () => {
        seen.push(hours);
        return [];
      },
      onPurged: () => undefined,
      log: quietLog,
    });
    hours = 120;
    t.fire();
    expect(seen).toEqual([720, 120]);
  });

  it("runNow runs once through the gate and resolves after the run, waiting for an export to end", async () => {
    const { OperationGate } = await import("../../../src/main/operation-gate");
    const clock = fakeClock(1000);
    const t = fakeTimer();
    const gate = new OperationGate();
    const runs: number[] = [];
    const stop = startPurgeScheduler({ clock, timer: t.timer, purge: (now) => (runs.push(now), []), onPurged: () => undefined, log: quietLog, gate });
    expect(runs).toEqual([1000]);
    await stop.runNow();
    expect(runs).toEqual([1000, 1000]);
    gate.tryBegin("export");
    let done = false;
    const pending = stop.runNow().then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    gate.end();
    await pending;
    expect(runs).toHaveLength(3);
  });
});

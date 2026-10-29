import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FATAL_EXIT_MS, MARKER_FILE, createFatalHandler, markerPath, readMarker, writeMarker, type FatalDeps } from "../../../src/main/startup/fatal";
import { tempDir } from "../db/helpers";

describe("L16 uncaught exceptions end the process in order (010 FR-026, research §8)", () => {
  let dir: string;
  let cleanup: () => void;
  let steps: string[];
  let logged: { event: string; fields: Record<string, unknown> }[];
  let timers: { fn: () => void; ms: number }[];

  const deps = (over: Partial<FatalDeps> = {}): FatalDeps => ({
    log: {
      fatal: (event, fields) => {
        logged.push({ event, fields });
        steps.push("log");
      },
      error: (event, fields) => {
        logged.push({ event, fields });
      },
    },
    now: () => 1_700_000_000_000,
    dataDir: dir,
    writable: true,
    stopSchedulers: () => {
      steps.push("stop");
    },
    flush: () => {
      steps.push("flush");
      return Promise.resolve();
    },
    closeDb: () => {
      steps.push("close");
    },
    exit: (code) => {
      steps.push(`exit ${String(code)}`);
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
    },
    ...over,
  });

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    steps = [];
    logged = [];
    timers = [];
  });
  afterEach(() => {
    cleanup();
  });

  it("L16 handleFatal runs the steps in order: log, marker, stop, flush, close, exit 1", async () => {
    await createFatalHandler(deps())(new Error("boom"));
    expect(steps).toEqual(["log", "stop", "flush", "close", "exit 1"]);
    expect(logged[0]).toMatchObject({ event: "main.uncaught-exception", fields: { message: "boom" } });
    expect(existsSync(markerPath(dir))).toBe(true);
    expect(timers).toEqual([{ fn: expect.any(Function) as () => void, ms: FATAL_EXIT_MS }]);
  });

  it("L16 the marker holds only the time, owner-only, and is not written when the folder is read-only", async () => {
    await createFatalHandler(deps())(new Error("boom"));
    expect(readFileSync(join(dir, MARKER_FILE), "utf8")).toBe('{"at":1700000000000}');
    if (process.platform !== "win32") expect(statSync(join(dir, MARKER_FILE)).mode & 0o777).toBe(0o600);
    steps = [];
    const other = tempDir();
    try {
      await createFatalHandler(deps({ dataDir: other.dir, writable: false }))(new Error("boom"));
      expect(existsSync(markerPath(other.dir))).toBe(false);
      expect(steps).toEqual(["log", "stop", "flush", "close", "exit 1"]);
    } finally {
      other.cleanup();
    }
  });

  it("L16 a second exception while handling exits at once", async () => {
    const slot: { release: (() => void) | null } = { release: null };
    const handler = createFatalHandler(
      deps({
        flush: () =>
          new Promise<void>((resolve) => {
            steps.push("flush");
            slot.release = resolve;
          }),
      }),
    );
    const first = handler(new Error("one"));
    await Promise.resolve();
    void handler(new Error("two"));
    expect(steps).toEqual(["log", "stop", "flush", "exit 1"]);
    slot.release?.();
    await first;
    expect(steps).toEqual(["log", "stop", "flush", "exit 1", "close", "exit 1"]);
  });

  it("L16 a hanging flush is cut by the 3 s timer", async () => {
    const handler = createFatalHandler(deps({ flush: () => new Promise<void>(() => undefined) }));
    void handler(new Error("hang"));
    await Promise.resolve();
    expect(steps).toEqual(["log", "stop"]);
    expect(timers[0]?.ms).toBe(3_000);
    timers[0]?.fn();
    expect(steps).toEqual(["log", "stop", "exit 1"]);
  });

  it("L16 failures inside the steps are logged and never stop the exit", async () => {
    await createFatalHandler(
      deps({
        stopSchedulers: () => {
          throw new Error("stop failed");
        },
        closeDb: () => {
          throw new Error("close failed");
        },
        flush: () => Promise.reject(new Error("flush failed")),
      }),
    )(new Error("boom"));
    expect(steps.at(-1)).toBe("exit 1");
    expect(logged.map((l) => l.event)).toEqual(["main.uncaught-exception", "fatal.stop-failed", "fatal.flush-failed", "fatal.close-failed"]);
  });

  it("L16 readMarker returns the time and removes the file; null when absent or unreadable", () => {
    expect(readMarker(dir)).toBeNull();
    writeMarker(dir, 42);
    expect(readMarker(dir)).toBe(42);
    expect(existsSync(markerPath(dir))).toBe(false);
    writeFileSync(markerPath(dir), "not json");
    expect(readMarker(dir)).toBeNull();
    expect(existsSync(markerPath(dir))).toBe(false);
    writeFileSync(markerPath(dir), '{"at":"soon"}');
    expect(readMarker(dir)).toBeNull();
  });
});

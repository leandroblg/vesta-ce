import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { loadLogSettings } from "../../../src/main/db/settings-repo";
import { initFaults } from "../../../src/main/faults";
import { dispatch, dispatchAsync, type HandlerDeps } from "../../../src/main/ipc/handlers";
import { TAIL_BATCH_MS, buildLogHandlers } from "../../../src/main/ipc/log-handlers";
import type { Logger, WrittenEntry } from "../../../src/main/log";
import { tempDir } from "../db/helpers";

describe("009 log handlers (contracts/ipc.md; FR-010, FR-017 to FR-019)", () => {
  let cleanup: () => void;
  let dir: string;
  let db: Database.Database;
  const clock = fakeClock(1_000);
  let log: Record<"fatal" | "error" | "warn" | "info" | "debug" | "trace", ReturnType<typeof vi.fn>>;
  let listeners: ((e: WrittenEntry) => void)[];
  let sent: { event: string; payload: unknown }[];
  let timers: (() => void)[];

  const build = () => {
    const setFloor = vi.fn();
    const built = buildLogHandlers({
      db: () => db,
      clock,
      dataDir: dir,
      log: log as unknown as Logger,
      watch: (_level, listener) => {
        listeners.push(listener);
        return () => {
          listeners = listeners.filter((l) => l !== listener);
        };
      },
      setFloor,
      send: (event, payload) => sent.push({ event, payload }),
      timer: { setTimeout: (fn) => timers.push(fn), clearTimeout: () => undefined },
    });
    return { ...built, setFloor, deps: { log } as unknown as HandlerDeps };
  };

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    log = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() };
    listeners = [];
    sent = [];
    timers = [];
  });
  afterEach(() => {
    delete process.env["VESTA_FAULT"];
    initFaults(true);
    try {
      chmodSync(join(dir, "logs"), 0o755);
    } catch {
      // none
    }
    db.close();
    cleanup();
  });

  it("stores the level and moves the recording floor at once", () => {
    const { handlers, setFloor, deps } = build();
    expect(dispatch(handlers, deps, "settings:set-log-level", { level: "debug" }).ok).toBe(true);
    expect(setFloor).toHaveBeenLastCalledWith("debug");
    expect(loadLogSettings(db).logLevel).toBe("debug");
    dispatch(handlers, deps, "settings:set-log-level", { level: "error" });
    expect(setFloor).toHaveBeenLastCalledWith("info");
  });

  it("a failed save leaves the floor and the stored level unchanged", () => {
    const { handlers, setFloor, deps } = build();
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    const r = dispatch(handlers, deps, "settings:set-log-level", { level: "trace" });
    expect(r.ok ? null : r.error.code).toBe("SAVE_FAILED");
    expect(setFloor).not.toHaveBeenCalled();
    expect(loadLogSettings(db).logLevel).toBe("info");
  });

  it("tails written entries in batches, newest first, while watching only", () => {
    const { handlers, deps } = build();
    dispatch(handlers, deps, "logs:watch", { on: true, level: "warn" });
    const entry = (event: string): WrittenEntry => ({ time: 5, level: "warn", event, fields: {} });
    listeners[0]?.(entry("a"));
    listeners[0]?.(entry("b"));
    expect(sent).toEqual([]);
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(sent).toEqual([{ event: "logs:appended", payload: { lines: [
      { time: 5, level: "warn", event: "b", fields: {}, raw: null, cut: false },
      { time: 5, level: "warn", event: "a", fields: {}, raw: null, cut: false },
    ] } }]);
    expect(TAIL_BATCH_MS).toBe(250);
    dispatch(handlers, deps, "logs:watch", { on: false, level: "warn" });
    expect(listeners).toEqual([]);
  });

  it("reads pages, and logs an unreadable folder once per viewer opening", async () => {
    const { handlers, asyncHandlers, deps } = build();
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "logs", "vesta-001.log"), '{"time":"2026-10-19T12:00:00.000Z","level":"info","event":"x"}\n');
    const page = await dispatchAsync(asyncHandlers, deps, "logs:read", { cursor: null, level: "info" });
    expect(page.ok && page.value.lines.map((l) => l.event)).toEqual(["x"]);
    if (process.getuid?.() === 0) return;
    chmodSync(join(dir, "logs"), 0o000);
    dispatch(handlers, deps, "logs:watch", { on: true, level: "info" });
    await dispatchAsync(asyncHandlers, deps, "logs:read", { cursor: null, level: "info" });
    await dispatchAsync(asyncHandlers, deps, "logs:read", { cursor: null, level: "error" });
    expect(log.error.mock.calls.filter(([e]) => e === "logs.read-failed")).toHaveLength(1);
    dispatch(handlers, deps, "logs:watch", { on: true, level: "info" });
    await dispatchAsync(asyncHandlers, deps, "logs:read", { cursor: null, level: "info" });
    expect(log.error.mock.calls.filter(([e]) => e === "logs.read-failed")).toHaveLength(2);
  });
});

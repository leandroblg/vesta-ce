// T024: the automatic backup and the operation gate (008 FR-050, FR-037c).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { readLatestJson } from "../../../src/main/backup/backup";
import { startBackupScheduler } from "../../../src/main/backup/scheduler";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { OperationGate } from "../../../src/main/operation-gate";
import { tempDir } from "../db/helpers";

const log = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined } as never;
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("backup scheduler and the operation gate", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
    cleanup();
  });

  it("writes no backup while an operation runs, then writes it once when the gate is idle", async () => {
    const clock = fakeClock(10_000);
    const gate = new OperationGate();
    gate.tryBegin("import");
    const stop = startBackupScheduler({ clock, dataDir: dir, db: () => db, log, onFailed: () => undefined, onDamaged: () => undefined, gate });
    await flush();
    expect(readLatestJson(dir)).toBeNull();
    vi.advanceTimersByTime(60_000);
    await flush();
    expect(readLatestJson(dir)).toBeNull();
    clock.advance(1);
    gate.end();
    // Polled, not a fixed wait: under a full suite's load the backup can take longer than a few ms.
    await vi.waitFor(() => {
      expect(readLatestJson(dir)?.writtenAt).toBe(10_001);
    });
    stop();
  });

  it("keeps the 001 timing when the gate stays idle", async () => {
    const clock = fakeClock(10_000);
    const stop = startBackupScheduler({ clock, dataDir: dir, db: () => db, log, onFailed: () => undefined, onDamaged: () => undefined, gate: new OperationGate() });
    await vi.waitFor(() => {
      expect(readLatestJson(dir)?.writtenAt).toBe(10_000);
    });
    stop();
  });
});

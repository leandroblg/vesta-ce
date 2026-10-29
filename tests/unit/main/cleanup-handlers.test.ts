// 018 contracts/ipc-cleanup.md (FR-020a to FR-020d; PRD Q277, Q282, Q287): a cleanup change, its confirmation and the
// countdown's time left.
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock, type FakeClock } from "../../../src/domain/clock";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { applyReminderChangeSet } from "../../../src/main/db/reminders-repo";
import { loadCleanupSettings } from "../../../src/main/db/settings-repo";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { buildCleanupHandlers, cleanupViews, type CleanupConfirm } from "../../../src/main/ipc/cleanup-handlers";
import { makeReminder, makeTask, tempDir } from "../db/helpers";

const HOUR = 3_600_000;
const T = 1_000_000_000_000;

describe("settings:set-cleanup and cleanup:status", () => {
  let db: Database.Database;
  let cleanup: () => void;
  let clock: FakeClock;
  let confirm: ReturnType<typeof vi.fn<CleanupConfirm>>;
  let info: ReturnType<typeof vi.fn<(event: string, data?: Record<string, unknown>) => void>>;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    clock = fakeClock(T);
    confirm = vi.fn<CleanupConfirm>(() => Promise.resolve(true));
    info = vi.fn<(event: string, data?: Record<string, unknown>) => void>();
  });
  afterEach(() => {
    db.close();
    cleanup();
  });
  const handlers = () => buildCleanupHandlers({ db: () => db, clock, log: { info }, confirm });
  const set = (which: "archive" | "trash", on: boolean, hours: number, commit = true) => {
    const h = handlers()["settings:set-cleanup"];
    if (h === undefined) throw new Error("missing handler");
    return h({ which, on, hours, commit });
  };
  const seedArchive = (n: number) => {
    const rows = Array.from({ length: n }, () => makeTask({ doneAt: T - 2 * HOUR, updatedAt: T - 2 * HOUR }));
    applyChangeSet(db, { upserts: rows, removals: [] });
  };

  it("a shorter time over expired rows, committed, asks once with the count; confirmed, it saves and starts the hour", async () => {
    seedArchive(3);
    const r = await set("archive", true, 1);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith({ kind: "cleanupArchive", count: 3 });
    expect(r).toEqual({ saved: true, pending: false, on: true, hours: 1, remainingMs: HOUR });
    expect(loadCleanupSettings(db)).toMatchObject({ settings: { archive: { on: true, hours: 1 } }, changedAt: { archive: T } });
    expect(info).toHaveBeenCalledWith("settings.cleanup", { which: "archive", on: true, hours: 1, confirmed: true });
  });

  it("cancelled, or closed without a button, it writes nothing and replies with the saved values", async () => {
    seedArchive(1);
    confirm.mockResolvedValue(false);
    expect(await set("archive", true, 1)).toEqual({ saved: false, pending: false, on: true, hours: 87_600, remainingMs: null });
    expect(loadCleanupSettings(db).changedAt).toEqual({});
  });

  it("sent before a commit, a change that needs a dialog asks nothing, writes nothing and is pending", async () => {
    seedArchive(2);
    expect(await set("archive", true, 1, false)).toEqual({ saved: false, pending: true, on: true, hours: 87_600, remainingMs: null });
    expect(confirm).not.toHaveBeenCalled();
    expect(loadCleanupSettings(db).settings.archive.hours).toBe(87_600);
  });

  it("a longer time, and a shorter one that removes nothing, save without asking, committed or not (Q287)", async () => {
    expect(await set("trash", true, 2000, false)).toEqual({ saved: true, pending: false, on: true, hours: 2000, remainingMs: HOUR });
    clock.advance(10);
    expect(await set("trash", true, 5, false)).toMatchObject({ saved: true, pending: false, hours: 5 });
    expect(confirm).not.toHaveBeenCalled();
    expect(loadCleanupSettings(db).changedAt).toEqual({ trash: T + 10 });
  });

  it("turning the Trash cleanup off asks the Trash-off box; the Archive cleanup off asks nothing", async () => {
    await set("trash", false, 720);
    expect(confirm).toHaveBeenCalledWith({ kind: "trashOff", count: 0 });
    confirm.mockClear();
    await set("archive", false, 87_600);
    expect(confirm).not.toHaveBeenCalled();
    expect(loadCleanupSettings(db).settings).toEqual({ archive: { on: false, hours: 87_600 }, trash: { on: false, hours: 720 } });
  });

  it("turning a cleanup on asks with the count when items would go, and saves at once when none would", async () => {
    await set("archive", false, 87_600);
    await set("archive", true, 87_600);
    expect(confirm).not.toHaveBeenCalled();
    await set("archive", false, 1);
    applyReminderChangeSet(db, { upserts: [makeReminder({ doneAt: T - 2 * HOUR, updatedAt: T - 2 * HOUR })], removals: [], sectionCollapsed: null }, T);
    await set("archive", true, 1);
    expect(confirm).toHaveBeenCalledWith({ kind: "cleanupArchive", count: 1 });
  });

  it("cleanup:status gives the time left of each hour, and null once it has passed", async () => {
    await set("trash", true, 2000);
    clock.advance(20 * 60_000);
    const status = handlers()["cleanup:status"];
    expect(await status?.(undefined)).toEqual({ archive: { remainingMs: null }, trash: { remainingMs: 40 * 60_000 } });
    expect(cleanupViews(db, clock.now()).trash).toEqual({ on: true, hours: 2000, remainingMs: 40 * 60_000 });
    clock.advance(40 * 60_000);
    expect(await status?.(undefined)).toEqual({ archive: { remainingMs: null }, trash: { remainingMs: null } });
  });
});

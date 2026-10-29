/** 017 FR-015a (PRD Q267, Q269): export and import are refused first, with their own outcome, while newer data is refused. */
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as restore from "../../../src/main/backup/restore-pre-import";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import * as repo from "../../../src/main/db/settings-repo";
import { buildDataHandlers, type DataDeps } from "../../../src/main/ipc/data-handlers";
import { tempDir } from "../db/helpers";

function deps(refused: boolean) {
  const pickPath = vi.fn(() => Promise.resolve(null));
  const tryBegin = vi.fn(() => true);
  const d = {
    dataRefused: () => refused,
    pickPath,
    flushRenderer: () => Promise.resolve(),
    gate: { tryBegin, end: vi.fn() },
  } as unknown as DataDeps;
  return { d, pickPath, tryBegin };
}

function handler<C extends "data:export" | "data:import">(handlers: ReturnType<typeof buildDataHandlers>, channel: C) {
  const h = handlers[channel];
  if (h === undefined) throw new Error(`no ${channel} handler`);
  return h;
}

describe("export and import while newer data is refused (017)", () => {
  it("refuse at once: no dialog, no operation started", async () => {
    const { d, pickPath, tryBegin } = deps(true);
    const handlers = buildDataHandlers(d);
    expect(await handler(handlers, "data:export")({ includeLogs: false })).toEqual({ kind: "dataRefused" });
    expect(await handler(handlers, "data:import")(undefined)).toEqual({ kind: "dataRefused" });
    expect(pickPath).not.toHaveBeenCalled();
    expect(tryBegin).not.toHaveBeenCalled();
  });

  it("otherwise go on to the dialog as before", async () => {
    const { d, pickPath } = deps(false);
    const handlers = buildDataHandlers(d);
    expect(await handler(handlers, "data:export")({ includeLogs: false })).toEqual({ kind: "cancelled" });
    expect(pickPath).toHaveBeenCalledWith("folder");
  });
});

describe("018 T083 FR-016a: Undo import restarts the hour of a cleanup it puts back", () => {
  it("writes the change time as now for a cleanup the undo changed, and keeps the other's", async () => {
    const { dir, cleanup } = tempDir();
    const db = openDatabase(join(dir, "data.sqlite"));
    try {
      migrate(db);
      // After the import: a longer Trash time, saved at 1_000; the Archive saved at 500.
      repo.saveCleanupSetting(db, "trash", true, 2_000, 1_000);
      repo.saveCleanupSetting(db, "archive", true, 87_600, 500);
      // The pre-import backup had the default Trash time; the undo puts it back, the Archive unchanged.
      const spy = vi.spyOn(restore, "restoreFromPreImport").mockImplementation((d) => {
        d.prepare("update settings set value = '720' where key = 'trashCleanupHours'").run();
      });
      const end = vi.fn();
      const d = {
        db: () => db,
        clock: { now: () => 9_000 },
        log: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
        offer: { isValid: () => true, end },
        applySettings: vi.fn(),
        kickSearch: vi.fn(),
        snapshot: () => ({}),
      } as unknown as DataDeps;
      const undo = buildDataHandlers(d)["data:undo-import"];
      if (undo === undefined) throw new Error("no undo handler");
      expect(await undo({ token: "t" })).toMatchObject({ kind: "undone" });
      expect(repo.loadCleanupSettings(db)).toMatchObject({ settings: { trash: { hours: 720 } }, changedAt: { trash: 9_000, archive: 500 } });
      expect(end).toHaveBeenCalled();
      spy.mockRestore();
    } finally {
      db.close();
      cleanup();
    }
  });
});

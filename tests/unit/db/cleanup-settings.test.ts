// 018 FR-016, FR-020b (research §5): the cleanup settings rows, their defaults and the local change times.
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeCleanupSettings } from "../../../src/domain/settings";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { loadCleanupSettings, saveCleanupSetting, writeCleanupChangedAt } from "../../../src/main/db/settings-repo";
import { initFaults } from "../../../src/main/faults";
import { tempDir } from "./helpers";

describe("normalizeCleanupSettings", () => {
  it("reads the four rows and the change times, falling back to the default and reporting a bad row", () => {
    expect(
      normalizeCleanupSettings({ archiveCleanupOn: "false", archiveCleanupHours: "100", trashCleanupOn: "true", trashCleanupHours: "720", trashCleanupChangedAt: "5" }),
    ).toEqual({ settings: { archive: { on: false, hours: 100 }, trash: { on: true, hours: 720 } }, changedAt: { trash: 5 }, issues: [] });
    const bad = normalizeCleanupSettings({ archiveCleanupOn: "1", trashCleanupHours: "0", trashCleanupOn: "true", archiveCleanupChangedAt: "x" });
    expect(bad.settings).toEqual({ archive: { on: true, hours: 87_600 }, trash: { on: true, hours: 720 } });
    expect(bad.changedAt).toEqual({});
    expect(bad.issues).toEqual([
      { key: "archiveCleanupOn", kind: "unreadable" },
      { key: "archiveCleanupHours", kind: "missing" },
      { key: "trashCleanupHours", kind: "unreadable" },
    ]);
  });
});

describe("cleanup settings rows", () => {
  let db: Database.Database;
  let cleanup: () => void;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("start at the defaults with no pending hour", () => {
    expect(loadCleanupSettings(db)).toEqual({ settings: { archive: { on: true, hours: 87_600 }, trash: { on: true, hours: 720 } }, changedAt: {}, issues: [] });
  });

  it("a save writes the switch, the time and the change time together; the change time alone can be written", () => {
    saveCleanupSetting(db, "trash", false, 120, 1_000);
    expect(loadCleanupSettings(db)).toMatchObject({ settings: { trash: { on: false, hours: 120 } }, changedAt: { trash: 1_000 } });
    writeCleanupChangedAt(db, "archive", 2_000);
    expect(loadCleanupSettings(db).changedAt).toEqual({ archive: 2_000, trash: 1_000 });
  });

  it("a save fault writes nothing", () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    expect(() => {
      saveCleanupSetting(db, "archive", false, 5, 1_000);
    }).toThrow();
    expect(loadCleanupSettings(db)).toMatchObject({ settings: { archive: { on: true, hours: 87_600 } }, changedAt: {} });
  });
});

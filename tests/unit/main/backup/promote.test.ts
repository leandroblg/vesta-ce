// T042: the pre-import backup becomes the latest backup (research §6; FR-037a).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isBackupDue } from "../../../../src/domain/backup-policy";
import { backupFile, backupInfoFile, readLatestJson, writeBackup } from "../../../../src/main/backup/backup";
import { promotePreImport } from "../../../../src/main/backup/promote";
import { listLocks } from "../../../../src/main/db/backup-locks-repo";
import { openDatabase } from "../../../../src/main/db/connection";
import { migrate } from "../../../../src/main/db/migrate";
import { applyChangeSet } from "../../../../src/main/db/tasks-repo";
import { makeTask, tempDir } from "../../db/helpers";

const log = { warn: () => undefined, error: () => undefined, info: () => undefined };
const A = "a".repeat(64);
const B = "b".repeat(64);

describe("promotePreImport", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: `![a](assets/${A}.png)` })], removals: [] });
    await writeBackup(db, dir, 1_000, log);
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: `![b](assets/${B}.png)` })], removals: [] });
    db.prepare("delete from tasks where details_md like ?").run(`%${A}%`);
    await writeBackup(db, dir, 2_000, log, "pre-import");
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("replaces latest with the pre-import backup, keeping its write time, and rebuilds the locks", () => {
    const preBytes = readFileSync(backupFile(dir, "pre-import"));
    promotePreImport(db, dir, log);
    expect(readFileSync(backupFile(dir)).equals(preBytes)).toBe(true);
    expect(existsSync(backupFile(dir, "pre-import"))).toBe(false);
    expect(existsSync(backupInfoFile(dir, "pre-import"))).toBe(false);
    expect(readLatestJson(dir)?.writtenAt).toBe(2_000);
    expect(listLocks(db)).toEqual([{ backup: "backups/latest.sqlite", path: `assets/${B}.png` }]);
    expect(isBackupDue(readLatestJson(dir)?.writtenAt ?? null, 2_000 + 30 * 60_000 - 1)).toBe(false);
    expect(isBackupDue(readLatestJson(dir)?.writtenAt ?? null, 2_000 + 30 * 60_000)).toBe(true);
  });

  it("does nothing when there is no pre-import backup", () => {
    promotePreImport(db, dir, log);
    const latest = readFileSync(backupFile(dir));
    promotePreImport(db, dir, log);
    expect(readFileSync(backupFile(dir)).equals(latest)).toBe(true);
  });
});

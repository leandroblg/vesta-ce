import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupFile, readBackupJson, readLatestJson, writeBackup } from "../../../src/main/backup/backup";
import { listLocks } from "../../../src/main/db/backup-locks-repo";
import { openDatabase } from "../../../src/main/db/connection";
import { LATEST_VERSION, migrate } from "../../../src/main/db/migrate";
import { applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { makeTask, tempDir } from "./helpers";

describe("writeBackup (FR-041, FR-041a, FR-041b)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Backed up" })], removals: [] });
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("writes backups/latest.sqlite and latest.json", async () => {
    expect(await writeBackup(db, dir, 1234)).toEqual({ kind: "written", at: 1234 });
    expect(readLatestJson(dir)).toEqual({ writtenAt: 1234, schemaVersion: LATEST_VERSION });
    const copy = openDatabase(join(dir, "backups", "latest.sqlite"), { readonly: true });
    expect(loadAll(copy).map((t) => t.titleMd)).toEqual(["Backed up"]);
    copy.close();
    expect(existsSync(join(dir, "backups", "latest.sqlite.tmp"))).toBe(false);
  });

  it("a failure leaves the previous backup and json untouched (FR-041a)", async () => {
    await writeBackup(db, dir, 1000);
    const before = readFileSync(join(dir, "backups", "latest.sqlite"));
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Newer" })], removals: [] });
    initFaults(false);
    process.env["VESTA_FAULT"] = "backup";
    const result = await writeBackup(db, dir, 2000);
    expect(result.kind).toBe("failed");
    expect(readFileSync(join(dir, "backups", "latest.sqlite")).equals(before)).toBe(true);
    expect(readLatestJson(dir)?.writtenAt).toBe(1000);
  });

  it("a live database failing the integrity check writes nothing (FR-041b)", async () => {
    const fake = { pragma: () => [{ integrity_check: "*** in database main ***\nPage 2 is never used" }] } as unknown as Database.Database;
    expect(await writeBackup(fake, dir, 3000)).toEqual({ kind: "damaged" });
    expect(existsSync(join(dir, "backups", "latest.sqlite"))).toBe(false);
  });

  it("readLatestJson returns null when missing or unreadable", () => {
    expect(readLatestJson(dir)).toBeNull();
    writeFileSync(join(dir, "backups.json"), "x");
  });
});

describe("named backups (008 research §4, FR-036a)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const log = { warn: () => undefined, error: () => undefined, info: () => undefined };
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Before import" })], removals: [] });
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("writes backups/pre-import.sqlite and .json, leaving latest untouched", async () => {
    await writeBackup(db, dir, 1000, log);
    const latest = readFileSync(join(dir, "backups", "latest.sqlite"));
    expect(await writeBackup(db, dir, 2000, log, "pre-import")).toEqual({ kind: "written", at: 2000 });
    expect(readBackupJson(dir, "pre-import")).toEqual({ writtenAt: 2000, schemaVersion: LATEST_VERSION });
    expect(readLatestJson(dir)?.writtenAt).toBe(1000);
    expect(readFileSync(join(dir, "backups", "latest.sqlite")).equals(latest)).toBe(true);
    const copy = openDatabase(backupFile(dir, "pre-import"), { readonly: true });
    expect(loadAll(copy).map((t) => t.titleMd)).toEqual(["Before import"]);
    copy.close();
  });

  it("fails on VESTA_FAULT=pre-import-backup and leaves nothing behind", async () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "pre-import-backup";
    expect((await writeBackup(db, dir, 2000, log, "pre-import")).kind).toBe("failed");
    expect(existsSync(backupFile(dir, "pre-import"))).toBe(false);
    expect(readBackupJson(dir, "pre-import")).toBeNull();
  });

  it("records the pre-import backup's locks and keeps latest's", async () => {
    const A = "a".repeat(64);
    const B = "b".repeat(64);
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: `![a](assets/${A}.png)` })], removals: [] });
    await writeBackup(db, dir, 1000, log);
    applyChangeSet(db, { upserts: [makeTask({ detailsMd: `![b](assets/${B}.png)` })], removals: [] });
    await writeBackup(db, dir, 2000, log, "pre-import");
    expect(listLocks(db)).toEqual([
      { backup: "backups/latest.sqlite", path: `assets/${A}.png` },
      { backup: "backups/pre-import.sqlite", path: `assets/${A}.png` },
      { backup: "backups/pre-import.sqlite", path: `assets/${B}.png` },
    ]);
  });
});

// T031: the comparator itself (research §12).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { insertAsset } from "../../../src/main/db/assets-repo";
import { makeTask, tempDir } from "../db/helpers";
import { readSnapshot, snapshotDiff } from "./export-compare";

describe("readSnapshot and snapshotDiff", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const H = "a".repeat(64);
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "One" })], removals: [] });
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", `${H}.png`), "png");
    insertAsset(db, { sha256: H, ext: "png", mimeType: "image/png", size: 3, createdAt: 1, removedAt: null });
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("finds no difference between a snapshot and itself", () => {
    expect(snapshotDiff(readSnapshot(db, dir), readSnapshot(db, dir))).toEqual([]);
  });

  it("ignores machine-local state: a file's insert time and tag, backup records", () => {
    const before = readSnapshot(db, dir);
    db.prepare("update assets set created_at = 99, removed_at = 5").run();
    db.prepare("insert into backup_assets (backup, path) values ('backups/latest.sqlite', ?)").run(`assets/${H}.png`);
    expect(snapshotDiff(before, readSnapshot(db, dir))).toEqual([]);
  });

  it("reports a changed field, a changed setting and changed file bytes", () => {
    const before = readSnapshot(db, dir);
    db.prepare("update tasks set title_md = 'Two'").run();
    db.prepare("update settings set updated_at = 7 where key = 'theme'").run();
    writeFileSync(join(dir, "assets", `${H}.png`), "PNG");
    const diff = snapshotDiff(before, readSnapshot(db, dir));
    expect(diff.some((d) => d.startsWith("task "))).toBe(true);
    expect(diff.some((d) => d.startsWith("settings"))).toBe(true);
    expect(diff.some((d) => d.startsWith(`file ${H}`))).toBe(true);
  });
});

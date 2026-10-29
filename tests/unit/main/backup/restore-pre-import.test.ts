// T042: restoring the pre-import backup on the live connection (research §4; FR-037, FR-037b).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBackup } from "../../../../src/main/backup/backup";
import { restoreFromPreImport } from "../../../../src/main/backup/restore-pre-import";
import { insertAsset } from "../../../../src/main/db/assets-repo";
import { listLocks } from "../../../../src/main/db/backup-locks-repo";
import { openDatabase } from "../../../../src/main/db/connection";
import { migrate } from "../../../../src/main/db/migrate";
import { applyReminderChangeSet } from "../../../../src/main/db/reminders-repo";
import { applyChangeSet } from "../../../../src/main/db/tasks-repo";
import { initFaults } from "../../../../src/main/faults";
import { makeReminder, makeTask, tempDir } from "../../db/helpers";
import { readSnapshot, snapshotDiff } from "../../fixtures/export-compare";

const log = { warn: () => undefined, error: () => undefined, info: () => undefined };

describe("restoreFromPreImport", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(async () => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const parent = makeTask({ titleMd: "Parent" });
    applyChangeSet(db, { upserts: [parent, makeTask({ titleMd: "Child", parentId: parent.id })], removals: [] });
    applyReminderChangeSet(db, { upserts: [makeReminder({ textMd: "Keep" })], removals: [], sectionCollapsed: true }, 3);
    insertAsset(db, { sha256: "a".repeat(64), ext: "png", mimeType: "image/png", size: 1, createdAt: 1, removedAt: null });
    await writeBackup(db, dir, 100, log, "pre-import");
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("puts tasks, reminders, settings and file rows back exactly, on the same connection", () => {
    const before = readSnapshot(db, dir);
    const locks = listLocks(db);
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Imported" })], removals: [] });
    db.prepare("update tasks set title_md = 'changed' where title_md = 'Parent'").run();
    db.prepare("delete from reminders").run();
    db.prepare("update settings set value = '\"dark\"', updated_at = 99 where key = 'theme'").run();
    insertAsset(db, { sha256: "b".repeat(64), ext: "pdf", mimeType: "application/pdf", size: 2, createdAt: 5, removedAt: null });
    restoreFromPreImport(db, dir);
    expect(snapshotDiff(before, readSnapshot(db, dir))).toEqual([]);
    expect(listLocks(db)).toEqual(locks);
    expect((db.prepare("select title_plain from search_docs where kind = 'task' order by title_plain").all() as { title_plain: string }[]).map((r) => r.title_plain)).toEqual([
      "Child",
      "Parent",
    ]);
  });

  it("changes nothing with VESTA_FAULT=undo-restore", () => {
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Imported" })], removals: [] });
    const merged = readSnapshot(db, dir);
    initFaults(false);
    process.env["VESTA_FAULT"] = "undo-restore";
    expect(() => {
      restoreFromPreImport(db, dir);
    }).toThrow();
    expect(snapshotDiff(merged, readSnapshot(db, dir))).toEqual([]);
  });
});

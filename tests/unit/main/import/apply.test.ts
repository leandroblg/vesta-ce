// T040: writing a merge plan (research §4; FR-031, FR-033, FR-034, FR-036, FR-037).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MergePlan } from "../../../../src/domain/export/merge";
import { applyImport } from "../../../../src/main/import/apply";
import { getAsset, insertAsset } from "../../../../src/main/db/assets-repo";
import { openDatabase } from "../../../../src/main/db/connection";
import { migrate } from "../../../../src/main/db/migrate";
import { loadReminders } from "../../../../src/main/db/reminders-repo";
import { applyChangeSet, loadAll } from "../../../../src/main/db/tasks-repo";
import { initFaults } from "../../../../src/main/faults";
import { makeReminder, makeTask, tempDir } from "../../db/helpers";
import { readSnapshot, snapshotDiff } from "../../fixtures/export-compare";

const H = "a".repeat(64);

function plan(over: Partial<MergePlan> = {}): MergePlan {
  return {
    taskUpserts: [],
    reminderUpserts: [],
    settingUpserts: [],
    assetsToAdd: [],
    counts: { added: 0, updated: 0, unchanged: 0 },
    repairs: [],
    eventUpserts: [],
    droppedShortcuts: [],
    ...over,
  };
}

describe("applyImport", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
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

  it("writes tasks with a parent arriving after its child, without tripping the one-level trigger", () => {
    const parent = makeTask({ id: "00000000-0000-4000-8000-0000000000aa" });
    const child = makeTask({ id: "00000000-0000-4000-8000-0000000000bb", parentId: parent.id });
    applyImport(db, plan({ taskUpserts: [child, parent] }), 10);
    expect(loadAll(db).find((t) => t.id === child.id)?.parentId).toBe(parent.id);
  });

  it("applies a two-level repair: C ← B becomes a subtask while its child A moves to C in the same write", () => {
    const c = makeTask();
    const b = makeTask();
    const a = makeTask({ parentId: b.id });
    applyChangeSet(db, { upserts: [c, b, a], removals: [] });
    applyImport(db, plan({ taskUpserts: [{ ...b, parentId: c.id, updatedAt: 9 }, { ...a, parentId: c.id, updatedAt: 9 }] }), 10);
    const rows = loadAll(db);
    expect(rows.find((t) => t.id === a.id)?.parentId).toBe(c.id);
    expect(rows.find((t) => t.id === b.id)?.parentId).toBe(c.id);
  });

  it("writes reminders and settings with their imported change times", () => {
    const r = makeReminder({ updatedAt: 77 });
    applyImport(
      db,
      plan({ reminderUpserts: [r], settingUpserts: [{ key: "theme", value: "dark", updatedAt: 55 }, { key: "shortcuts", value: { newTask: ["Mod+Alt+N"] }, updatedAt: 56 }] }),
      10,
    );
    expect(loadReminders(db)).toEqual([r]);
    const settings = db.prepare("select key, value, updated_at as t from settings where key in ('theme', 'shortcuts') order by key").all();
    expect(settings).toEqual([
      { key: "shortcuts", value: '{"newTask":["Mod+Alt+N"]}', t: 56 },
      { key: "theme", value: '"dark"', t: 55 },
    ]);
  });

  it("018 FR-016a an accepted cleanup row starts that cleanup's hour: its change time is the import moment", () => {
    applyImport(db, plan({ settingUpserts: [{ key: "trashCleanupHours", value: 2000, updatedAt: 55 }] }), 10_000);
    const rows = db.prepare("select key, value from settings where key like '%CleanupChangedAt' order by key").all();
    expect(rows).toEqual([{ key: "trashCleanupChangedAt", value: "10000" }]);
  });

  it("inserts the new files' rows and untags a tagged file an imported item references (FR-034)", () => {
    const B = "b".repeat(64);
    insertAsset(db, { sha256: B, ext: "png", mimeType: "image/png", size: 1, createdAt: 1, removedAt: null });
    db.prepare("update assets set removed_at = 5 where sha256 = ?").run(B);
    applyImport(
      db,
      plan({
        taskUpserts: [makeTask({ detailsMd: `![b](assets/${B}.jpg) ![a](assets/${H}.png)` })],
        assetsToAdd: [{ sha256: H, ext: "png", mimeType: "image/png", size: 3 }],
      }),
      10,
    );
    expect(getAsset(db, H)).toMatchObject({ ext: "png", mimeType: "image/png", size: 3, createdAt: 10, removedAt: null });
    expect(getAsset(db, B)?.removedAt).toBeNull();
  });

  it("keeps imported text byte for byte", () => {
    const text = "a\r\nb 🎉 \u0000 `x` <b>raw</b>";
    const t = makeTask({ titleMd: text, detailsMd: text });
    applyImport(db, plan({ taskUpserts: [t] }), 10);
    expect(loadAll(db)[0]).toEqual(t);
  });

  it("keeps the search index in step", () => {
    applyImport(db, plan({ taskUpserts: [makeTask({ titleMd: "zebracorn" })], reminderUpserts: [makeReminder({ textMd: "quokka" })] }), 10);
    const found = db.prepare("select kind, title_plain from search_docs order by kind").all();
    expect(found).toEqual([
      { kind: "reminder", title_plain: "quokka" },
      { kind: "task", title_plain: "zebracorn" },
    ]);
  });

  it("is all or nothing: VESTA_FAULT=import-write throws after the first statement and changes no table", () => {
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Before" })], removals: [] });
    const before = readSnapshot(db, dir);
    initFaults(false);
    process.env["VESTA_FAULT"] = "import-write";
    expect(() => {
      applyImport(
        db,
        plan({ taskUpserts: [makeTask({ titleMd: "New" })], reminderUpserts: [makeReminder()], settingUpserts: [{ key: "theme", value: "dark", updatedAt: 99 }] }),
        10,
      );
    }).toThrow();
    expect(snapshotDiff(before, readSnapshot(db, dir))).toEqual([]);
  });
});

// 012 FR-028c: an import that changes the global alert period applies the un-stale rule (PRD Q158).
describe("012 FR-028c applyImport and the alert period", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const DAY = 86_400_000;
  const NOW = 10 * DAY;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });
  const stale = () =>
    makeTask({ createdAt: NOW - 2 * DAY, staleBaseAt: NOW - 2 * DAY, staleSince: NOW - DAY, wasStale: true, lastBlinkAt: NOW - DAY });

  it("FR-028c a longer imported period un-stales a never-rescheduled stale task", () => {
    const t = stale();
    applyChangeSet(db, { upserts: [t], removals: [] });
    applyImport(db, plan({ settingUpserts: [{ key: "alertPeriodMin", value: 7 * 1440, updatedAt: 5 }] }), NOW);
    expect(loadAll(db).find((r) => r.id === t.id)).toMatchObject({ staleSince: null, wasStale: true, updatedAt: t.updatedAt });
  });

  it("FR-028c the same period leaves the task untouched", () => {
    const t = stale();
    applyChangeSet(db, { upserts: [t], removals: [] });
    applyImport(db, plan({ settingUpserts: [{ key: "alertPeriodMin", value: 1440, updatedAt: 5 }] }), NOW);
    expect(loadAll(db).find((r) => r.id === t.id)?.staleSince).toBe(NOW - DAY);
  });
});

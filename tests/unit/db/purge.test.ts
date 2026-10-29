import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAY_MS } from "../../../src/domain/cleanup";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { purgeExpired, purgeRulesAt } from "../../../src/main/db/purge";
import { saveCleanupSetting } from "../../../src/main/db/settings-repo";
import { applyReminderChangeSet, loadReminders } from "../../../src/main/db/reminders-repo";
import { applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { makeReminder, makeTask, tempDir } from "./helpers";
import { existsSync } from "node:fs";
import { importBytes } from "../../../src/main/assets/store";
import { listAssetHashes } from "../../../src/main/db/assets-repo";

const NOW = 100 * DAY_MS;

describe("purgeExpired (001 FR-035, 002 FR-019)", () => {
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

  function seed() {
    const oldTask = makeTask({ deletedAt: NOW - 31 * DAY_MS });
    const keptTask = makeTask({ deletedAt: NOW - DAY_MS });
    const oldRem = makeReminder({ deletedAt: NOW - 30 * DAY_MS });
    const keptRem = makeReminder({ deletedAt: NOW - DAY_MS });
    applyChangeSet(db, { upserts: [oldTask, keptTask], removals: [] });
    applyReminderChangeSet(db, { upserts: [oldRem, keptRem], removals: [], sectionCollapsed: null }, 1);
    return { oldTask, keptTask, oldRem, keptRem };
  }

  it("removes expired tasks and reminders in one run and returns both lists", () => {
    const { oldTask, keptTask, oldRem, keptRem } = seed();
    expect(purgeExpired(db, NOW)).toEqual({ removals: [oldTask.id], reminderRemovals: [oldRem.id], archive: 0, trash: 2 });
    expect(loadAll(db).map((t) => t.id)).toEqual([keptTask.id]);
    expect(loadReminders(db).map((r) => r.id)).toEqual([keptRem.id]);
  });

  it("a purge fault changes neither table, so the next run retries", () => {
    seed();
    initFaults(false);
    process.env["VESTA_FAULT"] = "purge";
    expect(() => purgeExpired(db, NOW)).toThrow();
    expect(loadAll(db)).toHaveLength(2);
    expect(loadReminders(db)).toHaveLength(2);
    delete process.env["VESTA_FAULT"];
    expect(purgeExpired(db, NOW).reminderRemovals).toHaveLength(1);
  });

  it("005 FR-032: removes stored files no item references, after the row purge, keeping shared ones", () => {
    const store = { dir, db, clock: { now: () => NOW } };
    const shared = importBytes(store, { name: "s.txt", bytes: Buffer.from("shared"), scope: "details" }).ref;
    const alone = importBytes(store, { name: "a.txt", bytes: Buffer.from("alone"), scope: "details" }).ref;
    const a = makeTask({ detailsMd: `[s](${shared}) [a](${alone})`, deletedAt: NOW - 31 * DAY_MS });
    const b = makeTask({ detailsMd: `[s](${shared})` });
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    const log = { error: () => undefined, warn: () => undefined, info: () => undefined };
    purgeExpired(db, NOW, { dir, log });
    expect(loadAll(db).map((t) => t.id)).toEqual([b.id]);
    expect(listAssetHashes(db)).toEqual([shared.slice(7, 71)]);
    expect(existsSync(join(dir, shared))).toBe(true);
    expect(existsSync(join(dir, alone))).toBe(false);
  });

  describe("018 both cleanups in one run (FR-017, FR-018, Q278)", () => {
    const HOUR = 3_600_000;
    function seedBoth() {
      const doneOld = makeTask({ doneAt: NOW - 20 * HOUR, updatedAt: NOW - 20 * HOUR });
      const doneOldSub = makeTask({ parentId: doneOld.id, doneAt: NOW - 20 * HOUR, leftWithId: doneOld.id, updatedAt: NOW - 20 * HOUR });
      const doneYoung = makeTask({ doneAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR });
      const trashOld = makeTask({ deletedAt: NOW - 20 * HOUR, keptDoneAt: NOW - 90 * HOUR });
      const trashYoung = makeTask({ deletedAt: NOW - 2 * HOUR, keptDoneAt: NOW - 90 * HOUR });
      const active = makeTask({ createdAt: NOW - 90 * HOUR });
      const remDone = makeReminder({ doneAt: NOW - 20 * HOUR, updatedAt: NOW - 20 * HOUR });
      const remGone = makeReminder({ deletedAt: NOW - 20 * HOUR });
      applyChangeSet(db, { upserts: [doneOld, doneOldSub, doneYoung, trashOld, trashYoung, active], removals: [] });
      applyReminderChangeSet(db, { upserts: [remDone, remGone], removals: [], sectionCollapsed: null }, 1);
      return { doneOld, doneOldSub, doneYoung, trashOld, trashYoung, active, remDone, remGone };
    }

    it("removes Archive rows by completion and Trash rows by deletion, with their groups, and counts each rule", () => {
      const r = seedBoth();
      const out = purgeExpired(db, NOW, undefined, { archive: { hours: 10 }, trash: { hours: 10 } });
      expect(out.removals.sort()).toEqual([r.doneOld.id, r.doneOldSub.id, r.trashOld.id].sort());
      expect(out.reminderRemovals.sort()).toEqual([r.remDone.id, r.remGone.id].sort());
      expect(out).toMatchObject({ archive: 3, trash: 2 });
      expect(loadAll(db).map((t) => t.id).sort()).toEqual([r.doneYoung.id, r.trashYoung.id, r.active.id].sort());
    });

    it("a cleanup passed as null removes nothing of its place", () => {
      const r = seedBoth();
      const onlyTrash = purgeExpired(db, NOW, undefined, { archive: null, trash: { hours: 10 } });
      expect(onlyTrash).toMatchObject({ archive: 0, trash: 2 });
      expect(loadAll(db).some((t) => t.id === r.doneOld.id)).toBe(true);
      const onlyArchive = purgeExpired(db, NOW, undefined, { archive: { hours: 10 }, trash: null });
      expect(onlyArchive).toMatchObject({ archive: 3, trash: 0 });
      expect(loadAll(db).some((t) => t.id === r.trashYoung.id)).toBe(true);
    });

    it("T080 FR-020b: a change under an hour ago holds that cleanup back, not the other; a restart keeps the hold", () => {
      const r = seedBoth();
      saveCleanupSetting(db, "archive", true, 10, NOW - HOUR + 1);
      expect(purgeRulesAt(db, NOW)).toEqual({ archive: null, trash: { hours: 720 } });
      saveCleanupSetting(db, "trash", true, 10, NOW - HOUR + 1);
      expect(purgeExpired(db, NOW, undefined, purgeRulesAt(db, NOW))).toMatchObject({ archive: 0, trash: 0 });
      // A restart: the same file opened again reads the change times it saved.
      db.close();
      db = openDatabase(join(dir, "data.sqlite"));
      expect(purgeRulesAt(db, NOW)).toEqual({ archive: null, trash: null });
      expect(loadAll(db).some((t) => t.id === r.doneOld.id)).toBe(true);
      // Once the hour has run out, both rules apply.
      expect(purgeRulesAt(db, NOW + 1)).toEqual({ archive: { hours: 10 }, trash: { hours: 10 } });
      expect(purgeExpired(db, NOW + 1, undefined, purgeRulesAt(db, NOW + 1))).toMatchObject({ archive: 3, trash: 2 });
    });

    it("T080: a cleanup that is off gives null, whatever its change time", () => {
      saveCleanupSetting(db, "trash", false, 10, 0);
      expect(purgeRulesAt(db, NOW)).toEqual({ archive: { hours: 87_600 }, trash: null });
    });

    it("a purge fault changes nothing", () => {
      seedBoth();
      initFaults(false);
      process.env["VESTA_FAULT"] = "purge";
      expect(() => purgeExpired(db, NOW, undefined, { archive: { hours: 10 }, trash: { hours: 10 } })).toThrow();
      expect(loadAll(db)).toHaveLength(6);
    });
  });
});


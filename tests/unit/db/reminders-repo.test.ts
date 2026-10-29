import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { applyReminderChangeSet, loadReminders, loadRemindersCollapsed } from "../../../src/main/db/reminders-repo";
import { SaveFailedError } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { makeReminder, tempDir } from "./helpers";

describe("reminders repository (FR-003, FR-018, FR-021, FR-022)", () => {
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

  it("loads every row in every state back as Reminder", () => {
    const rows = [
      makeReminder(),
      makeReminder({ doneAt: 5, prevSiblingId: "p", nextSiblingId: "n" }),
      makeReminder({ deletedAt: 6 }),
    ];
    applyReminderChangeSet(db, { upserts: rows, removals: [], sectionCollapsed: null }, 10);
    const loaded = loadReminders(db);
    expect(loaded).toHaveLength(3);
    for (const r of rows) expect(loaded.find((x) => x.id === r.id)).toEqual(r);
  });

  it("stores markdown text byte for byte (constitution III)", () => {
    const text = 'Call the bank before **Friday** [now]{color="#2f6fb0"} 🦷';
    applyReminderChangeSet(db, { upserts: [makeReminder({ textMd: text })], removals: [], sectionCollapsed: null }, 10);
    expect(loadReminders(db)[0]?.textMd).toBe(text);
  });

  it("reads the collapsed state as false when the setting row is missing", () => {
    expect(loadRemindersCollapsed(db)).toBe(false);
  });

  it("writes the remindersCollapsed setting with updated_at = now only when sectionCollapsed is set", () => {
    applyReminderChangeSet(db, { upserts: [], removals: [], sectionCollapsed: true }, 42);
    expect(loadRemindersCollapsed(db)).toBe(true);
    expect(db.prepare("select value, updated_at from settings where key = 'remindersCollapsed'").get()).toEqual({ value: "true", updated_at: 42 });
    applyReminderChangeSet(db, { upserts: [makeReminder()], removals: [], sectionCollapsed: null }, 99);
    expect(db.prepare("select value, updated_at from settings where key = 'remindersCollapsed'").get()).toEqual({ value: "true", updated_at: 42 });
    applyReminderChangeSet(db, { upserts: [], removals: [], sectionCollapsed: false }, 100);
    expect(loadRemindersCollapsed(db)).toBe(false);
  });

  it("updates rows and applies removals in the same transaction", () => {
    const a = makeReminder();
    const b = makeReminder();
    applyReminderChangeSet(db, { upserts: [a, b], removals: [], sectionCollapsed: null }, 1);
    applyReminderChangeSet(db, { upserts: [{ ...a, textMd: "changed", updatedAt: 2 }], removals: [b.id], sectionCollapsed: null }, 2);
    expect(loadReminders(db)).toEqual([{ ...a, textMd: "changed", updatedAt: 2 }]);
  });

  it("a forced save fault changes neither the rows nor the setting (FR-018, FR-022)", () => {
    const kept = makeReminder();
    applyReminderChangeSet(db, { upserts: [kept], removals: [], sectionCollapsed: true }, 1);
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    expect(() => {
      applyReminderChangeSet(db, { upserts: [makeReminder()], removals: [kept.id], sectionCollapsed: false }, 2);
    }).toThrow(SaveFailedError);
    delete process.env["VESTA_FAULT"];
    expect(loadReminders(db)).toEqual([kept]);
    expect(loadRemindersCollapsed(db)).toBe(true);
  });

  it("rejects a done-and-deleted row (CHECK) as a failed save", () => {
    expect(() => {
      applyReminderChangeSet(db, { upserts: [makeReminder({ doneAt: 1, deletedAt: 1 })], removals: [], sectionCollapsed: null }, 1);
    }).toThrow(SaveFailedError);
  });
});

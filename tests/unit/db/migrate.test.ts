import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { LATEST_VERSION, MIGRATIONS, currentVersion, migrate, needsUpgrade } from "../../../src/main/db/migrate";
import { tempDir } from "./helpers";

describe("migrations", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it("brings a fresh database to the latest version with the tasks schema", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    expect(currentVersion(db)).toBe(0);
    expect(needsUpgrade(db)).toBe(true);
    migrate(db);
    expect(currentVersion(db)).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(12);
    const cols = (db.prepare("pragma table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual([
      "id",
      "parent_id",
      "title_md",
      "position",
      "created_at",
      "updated_at",
      "done_at",
      "deleted_at",
      "collapsed",
      "prev_sibling_id",
      "next_sibling_id",
      "left_with_id",
      "alert_period_override_min",
      "stale_base_at",
      "stale_since",
      "was_stale",
      "last_blink_at",
      "first_blink_count",
      "manually_positioned",
      "last_signal_at",
      "details_md",
      "reschedule_for_min",
      "kept_done_at",
    ]);
    expect(needsUpgrade(db)).toBe(false);
    db.close();
  });

  it("is a no-op when already current", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    migrate(db);
    expect((db.prepare("select count(*) as n from schema_version").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("rolls back a failing migration and leaves the version unchanged", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const broken = [...MIGRATIONS, { version: LATEST_VERSION + 1, sql: "CREATE TABLE ok_part (x INTEGER); THIS IS NOT SQL;" }];
    expect(() => {
      migrate(db, broken);
    }).toThrow();
    expect(currentVersion(db)).toBe(LATEST_VERSION);
    const t = db.prepare("select name from sqlite_master where name = 'ok_part'").get();
    expect(t).toBeUndefined();
    db.close();
  });

  it("migration 2 adds the reminders and settings tables (002 data-model.md)", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const cols = (table: string) => (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(cols("reminders")).toEqual([
      "id",
      "text_md",
      "position",
      "created_at",
      "updated_at",
      "done_at",
      "deleted_at",
      "prev_sibling_id",
      "next_sibling_id",
      "kept_done_at",
    ]);
    expect(cols("settings")).toEqual(["key", "value", "updated_at"]);
    db.close();
  });

  it("migrates a version-1 database with tasks to version 2, keeping every task row unchanged", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    const v1 = MIGRATIONS.filter((m) => m.version === 1);
    migrate(db, v1);
    db.prepare(
      "insert into tasks (id, parent_id, title_md, position, created_at, updated_at, collapsed) values ('t1', null, 'Kept', 1, 5, 6, 1)",
    ).run();
    const before = db.prepare("select * from tasks").all();
    migrate(db, MIGRATIONS.filter((m) => m.version <= 2));
    expect(currentVersion(db)).toBe(2);
    expect(db.prepare("select * from tasks").all()).toEqual(before);
    db.close();
  });

  it("reminders reject a row that is both done and deleted", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    expect(() =>
      db
        .prepare("insert into reminders (id, text_md, position, created_at, updated_at, done_at, deleted_at) values ('r', 'x', 1, 1, 1, 2, 3)")
        .run(),
    ).toThrow(/CHECK/);
    db.close();
  });

  it("a failing migration 2 leaves a version-1 database at version 1", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    const v1 = MIGRATIONS.filter((m) => m.version === 1);
    migrate(db, v1);
    const brokenV2 = [...v1, { version: 2, sql: "CREATE TABLE reminders (x INTEGER); THIS IS NOT SQL;" }];
    expect(() => {
      migrate(db, brokenV2);
    }).toThrow();
    expect(currentVersion(db)).toBe(1);
    expect(db.prepare("select name from sqlite_master where name = 'reminders'").get()).toBeUndefined();
    db.close();
  });

  it("migrates a version-2 database to version 3: alert columns with their defaults (003 data-model.md)", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db, MIGRATIONS.filter((m) => m.version <= 2));
    const insert = db.prepare(
      "insert into tasks (id, parent_id, title_md, position, created_at, updated_at, done_at, deleted_at, collapsed) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insert.run("p", null, "Active", 1, 500, 600, null, null, 1);
    insert.run("s", "p", "Sub", 1, 700, 700, null, null, 0);
    insert.run("d", null, "Done", 2, 800, 900, 950, null, 0);
    insert.run("x", null, "Deleted", 3, 1000, 1000, null, 1100, 0);
    db.prepare("insert into settings (key, value, updated_at) values ('remindersCollapsed', 'true', 42)").run();
    const before = db.prepare("select * from tasks order by id").all() as Record<string, unknown>[];
    migrate(db, MIGRATIONS.filter((m) => m.version <= 3));
    expect(currentVersion(db)).toBe(3);
    const after = db.prepare("select * from tasks order by id").all() as Record<string, unknown>[];
    expect(after).toEqual(
      before.map((row) => ({
        ...row,
        alert_period_override_min: null,
        stale_base_at: row["created_at"],
        stale_since: null,
        was_stale: 0,
        last_blink_at: null,
        first_blink_count: null,
        manually_positioned: 0,
        last_signal_at: null,
      })),
    );
    expect(db.prepare("select key, value, updated_at from settings order by key").all()).toEqual([
      { key: "alertPeriodMin", value: "1440", updated_at: 0 },
      { key: "reblinkIntervalMin", value: "240", updated_at: 0 },
      { key: "remindersCollapsed", value: "true", updated_at: 42 },
      { key: "rescheduleToleranceMin", value: "1440", updated_at: 0 },
    ]);
    db.close();
  });

  it("migration 3 checks reject invalid alert values", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const base = "insert into tasks (id, title_md, position, created_at, updated_at, stale_base_at";
    for (const [col, value] of [
      ["was_stale", 2],
      ["manually_positioned", 2],
      ["first_blink_count", 2],
      ["alert_period_override_min", 59],
    ] as const) {
      expect(() => db.prepare(`${base}, ${col}) values ('t-${col}', 'x', 1, 1, 1, 1, ?)`).run(value)).toThrow(/CHECK/);
    }
    expect(() => db.prepare(`${base}, first_blink_count, alert_period_override_min) values ('ok', 'x', 1, 1, 1, 1, 3, 60)`).run()).not.toThrow();
    db.close();
  });

  it("a failing migration 3 leaves a version-2 database at version 2", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    const upTo2 = MIGRATIONS.filter((m) => m.version <= 2);
    migrate(db, upTo2);
    expect(() => {
      migrate(db, [...upTo2, { version: 3, sql: "ALTER TABLE tasks ADD COLUMN stale_since INTEGER NULL; THIS IS NOT SQL;" }]);
    }).toThrow();
    expect(currentVersion(db)).toBe(2);
    const cols = (db.prepare("pragma table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("stale_since");
    db.close();
  });

  describe("migration 4 (005 data-model.md)", () => {
    const HASH = "0123456789abcdef".repeat(4);
    const upTo3 = () => MIGRATIONS.filter((m) => m.version <= 3);

    it("gives every task of a version-3 database empty details, keeping the rest", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo3());
      const insert = db.prepare(
        "insert into tasks (id, parent_id, title_md, position, created_at, updated_at, done_at, deleted_at, stale_base_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      insert.run("p", null, "Active", 1, 500, 600, null, null, 500);
      insert.run("s", "p", "Sub", 1, 700, 700, null, null, 700);
      insert.run("d", null, "Done", 2, 800, 900, 950, null, 800);
      insert.run("x", null, "Deleted", 3, 1000, 1000, null, 1100, 1000);
      const before = db.prepare("select * from tasks order by id").all() as Record<string, unknown>[];
      migrate(db, MIGRATIONS.filter((m) => m.version <= 4));
      expect(currentVersion(db)).toBe(4);
      expect(db.prepare("select * from tasks order by id").all()).toEqual(before.map((row) => ({ ...row, details_md: "" })));
      db.close();
    });

    it("adds the assets table with its checks and a nullable removed_at", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db);
      const cols = (db.prepare("pragma table_info(assets)").all() as { name: string; notnull: number }[]).map((c) => [
        c.name,
        c.notnull,
      ]);
      expect(cols).toEqual([
        ["sha256", 1],
        ["ext", 1],
        ["mime_type", 1],
        ["size", 1],
        ["created_at", 1],
        ["removed_at", 0],
      ]);
      const insert = db.prepare("insert into assets (sha256, ext, mime_type, size, created_at) values (?, ?, ?, ?, ?)");
      expect(() => insert.run(HASH, "png", "image/png", 10, 1)).not.toThrow();
      expect(() => insert.run(HASH.toUpperCase(), "png", "image/png", 10, 1)).toThrow(/CHECK/);
      expect(() => insert.run(HASH.slice(1), "png", "image/png", 10, 1)).toThrow(/CHECK/);
      expect(() => insert.run(`${HASH.slice(1)}g`, "png", "image/png", 10, 1)).toThrow(/CHECK/);
      const other = "f".repeat(64);
      expect(() => insert.run(other, "png", "image/png", -1, 1)).toThrow(/CHECK/);
      expect(() => insert.run(other, "png", "image/png", 104857601, 1)).toThrow(/CHECK/);
      expect(() => insert.run(other, "a".repeat(17), "x", 1, 1)).toThrow(/CHECK/);
      expect(() => insert.run(other, "PNG", "x", 1, 1)).toThrow(/CHECK/);
      expect(() => insert.run(other, "", "application/octet-stream", 104857600, 1)).not.toThrow();
      db.close();
    });

    it("adds the backup_assets table with its key and checks", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db);
      const cols = (db.prepare("pragma table_info(backup_assets)").all() as { name: string; pk: number }[]).map((c) => [
        c.name,
        c.pk,
      ]);
      expect(cols).toEqual([
        ["backup", 1],
        ["path", 2],
      ]);
      const insert = db.prepare("insert into backup_assets (backup, path) values (?, ?)");
      expect(() => insert.run("backups/latest.sqlite", `assets/${HASH}.png`)).not.toThrow();
      expect(() => insert.run("backups/latest.sqlite", `assets/${HASH}`)).not.toThrow();
      expect(() => insert.run("backups/latest.sqlite", `assets/${HASH}.png`)).toThrow(/UNIQUE|PRIMARY/);
      expect(() => insert.run("latest.sqlite", `assets/${HASH}.pdf`)).toThrow(/CHECK/);
      expect(() => insert.run("backups/latest.sqlite", `files/${HASH}.pdf`)).toThrow(/CHECK/);
      expect(() => insert.run("backups/latest.sqlite", "assets/short.png")).toThrow(/CHECK/);
      expect(() => insert.run("backups/latest.sqlite", `assets/${HASH}.${"a".repeat(17)}`)).toThrow(/CHECK/);
      db.close();
    });

    it("adds the panelWidth setting, 420, never edited", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db);
      expect(db.prepare("select value, updated_at from settings where key = 'panelWidth'").get()).toEqual({
        value: "420",
        updated_at: 0,
      });
      db.close();
    });

    it("a failing migration 4 leaves a version-3 database at version 3", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo3());
      expect(() => {
        migrate(db, [...upTo3(), { version: 4, sql: "ALTER TABLE tasks ADD COLUMN details_md TEXT NOT NULL DEFAULT ''; NOT SQL;" }]);
      }).toThrow();
      expect(currentVersion(db)).toBe(3);
      const cols = (db.prepare("pragma table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).not.toContain("details_md");
      db.close();
    });
  });

  it("uses WAL and FULL synchronous (research.md §3)", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("synchronous", { simple: true })).toBe(2);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });
  describe("migration 5 (006 data-model.md)", () => {
    const upTo4 = () => MIGRATIONS.filter((m) => m.version <= 4);
    const cols = (db: ReturnType<typeof openDatabase>, table: string) =>
      (db.prepare(`pragma table_info(${table})`).all() as { name: string; type: string; notnull: number; pk: number }[]).map((c) => [
        c.name,
        c.type,
        c.notnull,
        c.pk,
      ]);

    it("adds search_docs, the trigram FTS5 table and the triggers, with no rows yet", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo4());
      db.prepare("insert into tasks (id, title_md, position, created_at, updated_at, stale_base_at) values ('t', 'Kept', 1, 1, 1, 1)").run();
      migrate(db, MIGRATIONS.filter((m) => m.version <= 5));
      expect(currentVersion(db)).toBe(5);
      expect(cols(db, "search_docs")).toEqual([
        ["rowid", "INTEGER", 0, 1],
        ["kind", "TEXT", 1, 0],
        ["item_id", "TEXT", 1, 0],
        ["title_plain", "TEXT", 1, 0],
        ["body_plain", "TEXT", 1, 0],
        ["title_key", "TEXT", 1, 0],
        ["body_key", "TEXT", 1, 0],
        ["pending", "INTEGER", 1, 0],
      ]);
      expect(db.prepare("select sql from sqlite_master where name = 'search_docs_pending'").pluck().get()).toMatch(/WHERE pending = 1/);
      const fts = db.prepare("select sql from sqlite_master where name = 'search_fts'").pluck().get() as string;
      expect(fts).toMatch(/fts5\(\s*title_key, body_key,\s*content = 'search_docs', content_rowid = 'rowid',\s*tokenize = 'trigram'\s*\)/);
      const triggers = (db.prepare("select name from sqlite_master where type = 'trigger' and name like '%search%' order by name").pluck().all() as string[]);
      expect(triggers).toEqual([
        "reminders_search_ad",
        "reminders_search_ai",
        "reminders_search_au",
        "search_docs_ad",
        "search_docs_ai",
        "search_docs_au",
        "tasks_search_ad",
        "tasks_search_ai",
        "tasks_search_au",
      ]);
      // The existing rows are indexed by the background fill, not the migration.
      expect(db.prepare("select count(*) from search_docs").pluck().get()).toBe(0);
      db.close();
    });

    it("rejects an unknown kind and a duplicate item", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db);
      const ins = db.prepare("insert into search_docs (kind, item_id, title_plain, body_plain, title_key, body_key) values (?, ?, '', '', '', '')");
      expect(() => ins.run("note", "x")).toThrow(/CHECK/);
      ins.run("task", "dup");
      expect(() => ins.run("task", "dup")).toThrow(/UNIQUE/);
      db.close();
    });

    it("a failing migration 5 leaves a version-4 database at version 4 with no search table", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo4());
      expect(() => {
        migrate(db, [...upTo4(), { version: 5, sql: "CREATE TABLE search_docs (x INTEGER); THIS IS NOT SQL;" }]);
      }).toThrow();
      expect(currentVersion(db)).toBe(4);
      expect(db.prepare("select name from sqlite_master where name like 'search%'").all()).toEqual([]);
      db.close();
    });
  });
  describe("migration 6 (007 data-model.md)", () => {
    const upTo5 = () => MIGRATIONS.filter((m) => m.version <= 5);
    const rows = (db: ReturnType<typeof openDatabase>) =>
      db.prepare("select key, value, updated_at from settings where key in ('theme', 'language', 'shortcuts') order by key").all();

    it("adds the theme, language and shortcuts rows with their defaults, never edited", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo5());
      migrate(db, MIGRATIONS.filter((m) => m.version <= 6));
      expect(currentVersion(db)).toBe(6);
      expect(rows(db)).toEqual([
        { key: "language", value: '"system"', updated_at: 0 },
        { key: "shortcuts", value: "{}", updated_at: 0 },
        { key: "theme", value: '"system"', updated_at: 0 },
      ]);
      db.close();
    });

    it("keeps a row that already exists (INSERT OR IGNORE)", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo5());
      db.prepare("insert into settings (key, value, updated_at) values ('theme', '\"dark\"', 5)").run();
      migrate(db, MIGRATIONS.filter((m) => m.version <= 6));
      expect(db.prepare("select value, updated_at from settings where key = 'theme'").get()).toEqual({ value: '"dark"', updated_at: 5 });
      db.close();
    });

    it("a failing migration 6 leaves a version-5 database at version 5", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo5());
      expect(() => {
        migrate(db, [...upTo5(), { version: 6, sql: "INSERT INTO settings (key, value, updated_at) VALUES ('theme', '\"x\"', 0); NOT SQL;" }]);
      }).toThrow();
      expect(currentVersion(db)).toBe(5);
      expect(rows(db)).toEqual([]);
      db.close();
    });
  });
  describe("migration 7 (009 data-model.md)", () => {
    const upTo6 = () => MIGRATIONS.filter((m) => m.version <= 6);
    const rows = (db: ReturnType<typeof openDatabase>) =>
      db.prepare("select key, value, updated_at from settings where key in ('logLevel', 'autoUpdateCheck', 'updateNotice') order by key").all();

    it("adds the log level and automatic update check rows with their defaults, and no update notice", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo6());
      migrate(db);
      expect(currentVersion(db)).toBe(LATEST_VERSION);
      expect(LATEST_VERSION).toBe(12);
      expect(rows(db)).toEqual([
        { key: "autoUpdateCheck", value: "true", updated_at: 0 },
        { key: "logLevel", value: '"info"', updated_at: 0 },
      ]);
      db.close();
    });

    it("keeps rows that already exist, such as ones written by an import (INSERT OR IGNORE)", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo6());
      db.prepare("insert into settings (key, value, updated_at) values ('logLevel', '\"debug\"', 9)").run();
      db.prepare("insert into settings (key, value, updated_at) values ('autoUpdateCheck', 'false', 9)").run();
      migrate(db);
      expect(rows(db)).toEqual([
        { key: "autoUpdateCheck", value: "false", updated_at: 9 },
        { key: "logLevel", value: '"debug"', updated_at: 9 },
      ]);
      db.close();
    });

    it("a failing migration 7 leaves a version-6 database at version 6", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo6());
      expect(() => {
        migrate(db, [...upTo6(), { version: 7, sql: "INSERT INTO settings (key, value, updated_at) VALUES ('logLevel', '\"info\"', 0); NOT SQL;" }]);
      }).toThrow();
      expect(currentVersion(db)).toBe(6);
      expect(rows(db)).toEqual([]);
      db.close();
    });
  });

  it("Q133 migration 008 inserts the reminder defaults and keeps existing values", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const row = (key: string) => (db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value;
    expect(row("updateReminder")).toBe("true");
    expect(row("updateReminderDays")).toBe("30");
    expect(MIGRATIONS.map((m) => m.version)).toContain(8);
    // updated_at = 0 like 006's and 007's rows (convergence T092): a missing row means damage, and an exported
    // choice applies over an untouched default under the newest-edit rule.
    const at = (key: string) => (db.prepare("select updated_at from settings where key = ?").get(key) as { updated_at: number }).updated_at;
    expect(at("updateReminder")).toBe(0);
    expect(at("updateReminderDays")).toBe(0);

    const other = openDatabase(join(dir, "other.sqlite"));
    migrate(other, MIGRATIONS.filter((m) => m.version <= 7));
    other.prepare("insert into settings (key, value, updated_at) values (?, ?, ?)").run("updateReminderDays", "90", 5);
    migrate(other);
    expect((other.prepare("select value from settings where key = ?").get("updateReminderDays") as { value: string }).value).toBe("90");
    expect(currentVersion(other)).toBe(LATEST_VERSION);
    other.close();
    db.close();
  });

  it("FR-016 migration 009 inserts the editor defaults and keeps existing values", () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const row = (key: string) =>
      db.prepare("select value, updated_at from settings where key = ?").get(key) as { value: string; updated_at: number } | undefined;
    expect(row("pinnedColors")).toEqual({ value: "[]", updated_at: 0 });
    expect(row("recentColors")).toEqual({ value: "[]", updated_at: 0 });
    expect(row("tableRowsFirst")).toEqual({ value: "false", updated_at: 0 });
    expect(LATEST_VERSION).toBe(12);

    const other = openDatabase(join(dir, "other.sqlite"));
    migrate(other, MIGRATIONS.filter((m) => m.version <= 8));
    other.prepare("insert into settings (key, value, updated_at) values (?, ?, ?)").run("tableRowsFirst", "true", 5);
    migrate(other);
    expect((other.prepare("select value from settings where key = ?").get("tableRowsFirst") as { value: string }).value).toBe("true");
    expect(currentVersion(other)).toBe(LATEST_VERSION);
    other.close();
    db.close();
  });
  describe("migration 11 (015 data-model.md, research §4)", () => {
    const upTo10 = () => MIGRATIONS.filter((m) => m.version <= 10);
    const insertTask = (db: ReturnType<typeof openDatabase>, id: string) =>
      db
        .prepare(
          "insert into tasks (id, parent_id, title_md, position, created_at, updated_at, stale_base_at, was_stale, details_md) values (?, null, 'T', 1, 1000, 1000, 1000, 1, '')",
        )
        .run(id);

    it("adds tasks.reschedule_for_min (null on existing rows) and an empty task_events table (FR-024)", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo10());
      insertTask(db, "a");
      const before = db.prepare("select * from tasks where id = 'a'").get() as Record<string, unknown>;
      migrate(db, MIGRATIONS.filter((m) => m.version <= 11));
      expect(currentVersion(db)).toBe(11);
      const after = db.prepare("select * from tasks where id = 'a'").get() as Record<string, unknown>;
      expect(after).toEqual({ ...before, reschedule_for_min: null });
      expect((db.prepare("select count(*) as n from task_events").get() as { n: number }).n).toBe(0);
      db.close();
    });

    it("seeds the four quick reschedule durations at updated_at 0 and keeps existing rows", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo10());
      db.prepare("insert into settings (key, value, updated_at) values ('quickReschedule2Min', '90', 7)").run();
      migrate(db);
      const rows = db.prepare("select key, value, updated_at from settings where key like 'quickReschedule%' order by key").all();
      expect(rows).toEqual([
        { key: "quickReschedule1Min", value: "60", updated_at: 0 },
        { key: "quickReschedule2Min", value: "90", updated_at: 7 },
        { key: "quickReschedule3Min", value: "240", updated_at: 0 },
        { key: "quickReschedule4Min", value: "360", updated_at: 0 },
      ]);
      db.close();
    });

    it("rejects an unknown event kind and deletes a task's events with the task (cascade)", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db);
      insertTask(db, "a");
      const ins = db.prepare("insert into task_events (id, task_id, kind, at, detail) values (?, 'a', ?, 5, null)");
      for (const kind of ["created", "stale", "unstale", "rescheduled", "override_set", "override_changed", "override_cleared", "done", "trashed", "restored"])
        ins.run(`e-${kind}`, kind);
      expect(() => ins.run("e-bad", "edited")).toThrow();
      expect((db.prepare("select count(*) as n from task_events").get() as { n: number }).n).toBe(10);
      db.prepare("delete from tasks where id = 'a'").run();
      expect((db.prepare("select count(*) as n from task_events").get() as { n: number }).n).toBe(0);
      db.close();
    });
  });

  describe("migration 12 (018 data-model.md)", () => {
    const upTo11 = () => MIGRATIONS.filter((m) => m.version <= 11);
    const insertTask = (db: ReturnType<typeof openDatabase>, id: string, doneAt: number | null, deletedAt: number | null) =>
      db
        .prepare(
          "insert into tasks (id, parent_id, title_md, position, created_at, updated_at, done_at, deleted_at, stale_base_at, was_stale, details_md) values (?, null, 'T', 1, 1000, 1000, ?, ?, 1000, 0, '')",
        )
        .run(id, doneAt, deletedAt);

    it("adds a nullable kept_done_at to tasks and reminders, null on existing rows", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo11());
      insertTask(db, "a", 2000, null);
      db.prepare("insert into reminders (id, text_md, position, created_at, updated_at) values ('r', 'R', 1, 1000, 1000)").run();
      const task = db.prepare("select * from tasks where id = 'a'").get() as Record<string, unknown>;
      const reminder = db.prepare("select * from reminders where id = 'r'").get() as Record<string, unknown>;
      migrate(db);
      expect(currentVersion(db)).toBe(12);
      expect(db.prepare("select * from tasks where id = 'a'").get()).toEqual({ ...task, kept_done_at: null });
      expect(db.prepare("select * from reminders where id = 'r'").get()).toEqual({ ...reminder, kept_done_at: null });
      for (const table of ["tasks", "reminders"]) {
        const col = (db.prepare(`pragma table_info(${table})`).all() as { name: string; type: string; notnull: number }[]).find(
          (c) => c.name === "kept_done_at",
        );
        expect(col).toMatchObject({ type: "INTEGER", notnull: 0 });
      }
      db.close();
    });

    it("seeds the four cleanup settings at updated_at 0 and keeps an existing row", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db, upTo11());
      db.prepare("insert into settings (key, value, updated_at) values ('trashCleanupHours', '120', 9)").run();
      migrate(db);
      const rows = db
        .prepare("select key, value, updated_at from settings where key like '%Cleanup%' order by key")
        .all();
      expect(rows).toEqual([
        { key: "archiveCleanupHours", value: "87600", updated_at: 0 },
        { key: "archiveCleanupOn", value: "true", updated_at: 0 },
        { key: "trashCleanupHours", value: "120", updated_at: 9 },
        { key: "trashCleanupOn", value: "true", updated_at: 0 },
      ]);
      db.close();
    });

    it("still refuses a row both done and deleted", () => {
      const db = openDatabase(join(dir, "data.sqlite"));
      migrate(db);
      expect(() => insertTask(db, "b", 2000, 3000)).toThrow();
      expect(() =>
        db
          .prepare("insert into reminders (id, text_md, position, created_at, updated_at, done_at, deleted_at) values ('r', 'R', 1, 1, 1, 2, 3)")
          .run(),
      ).toThrow();
      insertTask(db, "c", null, 3000);
      db.prepare("update tasks set kept_done_at = 2000 where id = 'c'").run();
      expect((db.prepare("select kept_done_at from tasks where id = 'c'").get() as { kept_done_at: number }).kept_done_at).toBe(2000);
      db.close();
    });
  });
});

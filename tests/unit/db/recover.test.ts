import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeBackup } from "../../../src/main/backup/backup";
import { openDatabase } from "../../../src/main/db/connection";
import { LATEST_VERSION, MIGRATIONS, currentVersion, migrate } from "../../../src/main/db/migrate";
import { applyReminderChangeSet, loadReminders, loadRemindersCollapsed } from "../../../src/main/db/reminders-repo";
import { applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import { readLatestJson } from "../../../src/main/backup/backup";
import { openWithRecovery } from "../../../src/main/startup/recover";
import { makeReminder, makeTask, tempDir } from "./helpers";

const quietLog = { fatal: () => undefined, error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined, trace: () => undefined };

function seed(dir: string, titles: string[]): void {
  const db = openDatabase(join(dir, "data.sqlite"));
  migrate(db);
  applyChangeSet(db, { upserts: titles.map((titleMd) => makeTask({ titleMd })), removals: [] });
  db.close();
}

/** A task row written with plain SQL, for databases older than the current schema. */
function insertOldTask(db: Database.Database, title: string): void {
  db.prepare("insert into tasks (id, title_md, position, created_at, updated_at) values (?, ?, 1, 1000, 1000)").run(`old-${title}`, title);
}

/** Writes a backup holding `titles` into `dir/backups`, using a database in a separate temp folder. */
async function backupOf(dir: string, titles: string[], at: number): Promise<void> {
  const other = tempDir();
  const db = openDatabase(join(other.dir, "seed.sqlite"));
  migrate(db);
  applyChangeSet(db, { upserts: titles.map((titleMd) => makeTask({ titleMd })), removals: [] });
  await writeBackup(db, dir, at);
  db.close();
  other.cleanup();
}


/** A reminder written with only the columns an older schema has (018's kept_done_at, for one, comes later). */
function insertOldReminder(db: ReturnType<typeof openDatabase>, r: ReturnType<typeof makeReminder>): void {
  db.prepare(
    "insert into reminders (id, text_md, position, created_at, updated_at, done_at, deleted_at, prev_sibling_id, next_sibling_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(r.id, r.textMd, r.position, r.createdAt, r.updatedAt, r.doneAt, r.deletedAt, r.prevSiblingId, r.nextSiblingId);
}

describe("openWithRecovery (FR-042, FR-042a, FR-043)", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  it("first run: creates a fresh database, no notice", async () => {
    const r = await openWithRecovery({ dataDir: dir, now: 1, log: quietLog });
    expect(r.result).toEqual({ kind: "firstRun" });
    expect(currentVersion(r.db)).toBe(LATEST_VERSION);
    r.db.close();
  });

  it("healthy database: ok, rows kept", async () => {
    seed(dir, ["Kept"]);
    const r = await openWithRecovery({ dataDir: dir, now: 1, log: quietLog });
    expect(r.result).toEqual({ kind: "ok" });
    expect(loadAll(r.db).map((t) => t.titleMd)).toEqual(["Kept"]);
    r.db.close();
  });

  it("corrupt with a valid backup: restores it, deletes the corrupt file, sets aside unknown files, drops old damaged copies", async () => {
    await backupOf(dir, ["From backup"], 4242);
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 7));
    writeFileSync(join(dir, "data.sqlite-wal"), "leftover");
    writeFileSync(join(dir, "stray.txt"), "stray");
    mkdirSync(join(dir, "damaged"));
    writeFileSync(join(dir, "damaged", "data-1.sqlite"), "old damaged");
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "logs", "vesta-001.log"), "");
    // Electron/Chromium profile files sharing the folder in packaged builds stay put.
    mkdirSync(join(dir, "Session"));
    writeFileSync(join(dir, "Local State"), "{}");
    writeFileSync(join(dir, "SingletonLock"), "");

    const r = await openWithRecovery({ dataDir: dir, now: 9999, log: quietLog });
    expect(r.result.kind).toBe("restored");
    if (r.result.kind !== "restored") throw new Error("unreachable");
    expect(r.result.backupAt).toBe(4242);
    expect(loadAll(r.db).map((t) => t.titleMd)).toEqual(["From backup"]);
    const moved = r.result.moved;
    expect(moved?.count).toBeGreaterThanOrEqual(2);
    const folder = moved?.folder ?? "";
    expect(readdirSync(folder).sort()).toEqual(expect.arrayContaining(["data.sqlite-wal", "stray.txt"]));
    expect(existsSync(join(dir, "logs", "vesta-001.log"))).toBe(true);
    for (const kept of ["Session", "Local State", "SingletonLock"]) expect(existsSync(join(dir, kept))).toBe(true);
    expect(existsSync(join(dir, "backups", "latest.sqlite"))).toBe(true);
    expect(readdirSync(join(dir, "damaged"))).toEqual([]);
    r.db.close();
  });

  it("an older backup is migrated after restore; a failing migration counts as no valid backup", async () => {
    await backupOf(dir, ["Old schema"], 10);
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 1));
    // Fails only on a database that has tasks (the backup), so the empty start still works.
    const broken = [...MIGRATIONS, { version: LATEST_VERSION + 1, sql: "CREATE TABLE t2 (x INTEGER NOT NULL); INSERT INTO t2 SELECT NULL FROM tasks;" }];
    const r = await openWithRecovery({ dataDir: dir, now: 20, log: quietLog, migrations: broken });
    expect(r.result.kind).toBe("unrecoverable");
    r.db.close();
  });

  it("corrupt with an invalid backup: damaged copy kept (only the latest), empty start, unrecoverable", async () => {
    mkdirSync(join(dir, "backups"), { recursive: true });
    writeFileSync(join(dir, "backups", "latest.sqlite"), "not a database");
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 3));
    mkdirSync(join(dir, "damaged"));
    writeFileSync(join(dir, "damaged", "data-1.sqlite"), "older damaged");
    const r = await openWithRecovery({ dataDir: dir, now: 777, log: quietLog });
    expect(r.result).toEqual({ kind: "unrecoverable", damagedPath: join(dir, "damaged", "data-777.sqlite") });
    expect(readdirSync(join(dir, "damaged"))).toEqual(["data-777.sqlite"]);
    expect(loadAll(r.db)).toEqual([]);
    r.db.close();
  });

  it("corrupt with no backup file: damaged copy kept, empty start, first run (no notice)", async () => {
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 9));
    const r = await openWithRecovery({ dataDir: dir, now: 55, log: quietLog });
    expect(r.result).toEqual({ kind: "firstRun" });
    expect(readdirSync(join(dir, "damaged"))).toEqual(["data-55.sqlite"]);
    r.db.close();
  });

  it("an older database gets a pre-upgrade backup before it is migrated (FR-043)", async () => {
    const db = new Database(join(dir, "data.sqlite"));
    db.exec("create table schema_version (version integer not null); insert into schema_version values (0);");
    db.close();
    const v2 = [
      { version: 1, sql: "create table if not exists marker (x integer);" },
    ];
    const r = await openWithRecovery({ dataDir: dir, now: 31, log: quietLog, migrations: v2 });
    expect(r.result).toEqual({ kind: "ok" });
    expect(existsSync(join(dir, "backups", "latest.sqlite"))).toBe(true);
    const copy = new Database(join(dir, "backups", "latest.sqlite"), { readonly: true });
    expect(currentVersion(copy)).toBe(0);
    copy.close();
    r.db.close();
  });

  it("a version-1 backup restored at start is upgraded to the latest version and keeps its tasks (002 FR-021)", async () => {
    const other = tempDir();
    const v1db = openDatabase(join(other.dir, "seed.sqlite"));
    migrate(v1db, MIGRATIONS.filter((m) => m.version === 1));
    insertOldTask(v1db, "From v1 backup");
    await writeBackup(v1db, dir, 100);
    v1db.close();
    other.cleanup();
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 2));
    const r = await openWithRecovery({ dataDir: dir, now: 200, log: quietLog });
    expect(r.result.kind).toBe("restored");
    expect(currentVersion(r.db)).toBe(LATEST_VERSION);
    expect(loadAll(r.db).map((t) => t.titleMd)).toEqual(["From v1 backup"]);
    expect(loadReminders(r.db)).toEqual([]);
    r.db.close();
  });

  it("a version-1 database gets its pre-upgrade backup before migrations run (001 FR-043)", async () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db, MIGRATIONS.filter((m) => m.version === 1));
    insertOldTask(db, "Before upgrade");
    db.close();
    const r = await openWithRecovery({ dataDir: dir, now: 300, log: quietLog });
    expect(r.result).toEqual({ kind: "ok" });
    expect(currentVersion(r.db)).toBe(LATEST_VERSION);
    expect(readLatestJson(dir)?.schemaVersion).toBe(1);
    const copy = new Database(join(dir, "backups", "latest.sqlite"), { readonly: true });
    expect(currentVersion(copy)).toBe(1);
    copy.close();
    r.db.close();
  });

  it("a version-2 backup restored at start is upgraded to version 3 with its tasks and reminders (003 FR-042)", async () => {
    const other = tempDir();
    const v2db = openDatabase(join(other.dir, "seed.sqlite"));
    migrate(v2db, MIGRATIONS.filter((m) => m.version <= 2));
    insertOldTask(v2db, "From v2 backup");
    insertOldReminder(v2db, makeReminder({ textMd: "Kept reminder" }));
    await writeBackup(v2db, dir, 100);
    v2db.close();
    other.cleanup();
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 2));
    const r = await openWithRecovery({ dataDir: dir, now: 200, log: quietLog });
    expect(r.result.kind).toBe("restored");
    expect(currentVersion(r.db)).toBe(LATEST_VERSION);
    const [task] = loadAll(r.db);
    expect(task).toMatchObject({ titleMd: "From v2 backup", staleBaseAt: 1000, staleSince: null, wasStale: false, lastSignalAt: null });
    expect(loadReminders(r.db).map((x) => x.textMd)).toEqual(["Kept reminder"]);
    r.db.close();
  });

  it("a version-2 database gets its pre-upgrade backup before migration 3 runs (001 FR-043)", async () => {
    const db = openDatabase(join(dir, "data.sqlite"));
    migrate(db, MIGRATIONS.filter((m) => m.version <= 2));
    insertOldTask(db, "Before upgrade");
    db.close();
    const r = await openWithRecovery({ dataDir: dir, now: 300, log: quietLog });
    expect(r.result).toEqual({ kind: "ok" });
    expect(currentVersion(r.db)).toBe(LATEST_VERSION);
    expect(readLatestJson(dir)?.schemaVersion).toBe(2);
    const copy = new Database(join(dir, "backups", "latest.sqlite"), { readonly: true });
    expect(currentVersion(copy)).toBe(2);
    copy.close();
    r.db.close();
  });

  it("a version-3 database with every alert field set comes back identical from its backup (003 FR-041)", async () => {
    const other = tempDir();
    const src = openDatabase(join(other.dir, "seed.sqlite"));
    migrate(src);
    const parent = makeTask({ collapsed: true, alertOverrideMin: 10_080, staleSince: 90_000, wasStale: true, lastBlinkAt: 95_000, firstBlinkCount: 3, manuallyPositioned: true });
    const sub = makeTask({ parentId: parent.id, staleBaseAt: 50_000, staleSince: 60_000, wasStale: true, firstBlinkCount: 1, lastSignalAt: 61_000 });
    applyChangeSet(src, { upserts: [parent, sub], removals: [] });
    await writeBackup(src, dir, 100);
    src.close();
    other.cleanup();
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 2));
    const r = await openWithRecovery({ dataDir: dir, now: 200, log: quietLog });
    expect(r.result.kind).toBe("restored");
    expect(loadAll(r.db).sort((a, b) => a.id.localeCompare(b.id))).toEqual([parent, sub].sort((a, b) => a.id.localeCompare(b.id)));
    r.db.close();
  });

  it("a backup holding reminders and the collapsed setting restores both (002 FR-021)", async () => {
    const other = tempDir();
    const src = openDatabase(join(other.dir, "seed.sqlite"));
    migrate(src);
    const rows = [
      makeReminder({ textMd: "Active" }),
      makeReminder({ textMd: "Done", doneAt: 5 }),
      makeReminder({ textMd: "Deleted", deletedAt: 6 }),
    ];
    applyReminderChangeSet(src, { upserts: rows, removals: [], sectionCollapsed: true }, 7);
    await writeBackup(src, dir, 400);
    src.close();
    other.cleanup();
    writeFileSync(join(dir, "data.sqlite"), Buffer.alloc(4096, 4));
    const r = await openWithRecovery({ dataDir: dir, now: 500, log: quietLog });
    expect(r.result.kind).toBe("restored");
    expect(loadReminders(r.db)).toEqual(expect.arrayContaining(rows));
    expect(loadReminders(r.db)).toHaveLength(3);
    expect(loadRemindersCollapsed(r.db)).toBe(true);
    r.db.close();
  });

  it("008 FR-037a: a valid pre-import backup left by a crash is promoted to latest before the start plan", async () => {
    seed(dir, ["Now"]);
    await backupOf(dir, ["Old latest"], 1_000);
    const other = tempDir();
    const pre = openDatabase(join(other.dir, "pre.sqlite"));
    migrate(pre);
    applyChangeSet(pre, { upserts: [makeTask({ titleMd: "Pre-import" })], removals: [] });
    const { writeBackup: write } = await import("../../../src/main/backup/backup");
    await write(pre, dir, 2_000, undefined, "pre-import");
    pre.close();
    other.cleanup();
    const { db, result } = await openWithRecovery({ dataDir: dir, now: 5_000, log: quietLog });
    expect(result.kind).toBe("ok");
    expect(loadAll(db).map((t) => t.titleMd)).toEqual(["Now"]);
    db.close();
    expect(existsSync(join(dir, "backups", "pre-import.sqlite"))).toBe(false);
    expect(readLatestJson(dir)?.writtenAt).toBe(2_000);
    const latest = new Database(join(dir, "backups", "latest.sqlite"), { readonly: true });
    expect((latest.prepare("select title_md from tasks").all() as { title_md: string }[]).map((r) => r.title_md)).toEqual(["Pre-import"]);
    latest.close();
  });

  it("008 FR-037a: an invalid pre-import backup is deleted, latest kept", async () => {
    seed(dir, ["Now"]);
    await backupOf(dir, ["Old latest"], 1_000);
    writeFileSync(join(dir, "backups", "pre-import.sqlite"), "not a database");
    writeFileSync(join(dir, "backups", "pre-import.json"), "{}");
    const { db } = await openWithRecovery({ dataDir: dir, now: 5_000, log: quietLog });
    db.close();
    expect(existsSync(join(dir, "backups", "pre-import.sqlite"))).toBe(false);
    expect(existsSync(join(dir, "backups", "pre-import.json"))).toBe(false);
    expect(readLatestJson(dir)?.writtenAt).toBe(1_000);
  });
});


describe("data saved by a newer version (017 FR-015a, PRD Q263; contracts/newer-data.md Invariant)", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    cleanup();
  });

  /** Every file under the data folder with its bytes, except SQLite's -wal and -shm side files. */
  function snapshot(root: string): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (!/-(wal|shm)$/.test(e.name)) out.set(p.slice(root.length), readFileSync(p).toString("base64"));
      }
    };
    walk(root);
    return out;
  }

  it("an older build refuses newer data and changes none of it, a pending pre-import backup included", async () => {
    seed(dir, ["From the newer beta"]);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", `${"a".repeat(64)}.png`), "png bytes");
    await backupOf(dir, ["Backed up"], 1_000);
    const pre = openDatabase(join(dir, "data.sqlite"));
    await writeBackup(pre, dir, 2_000, undefined, "pre-import");
    pre.close();
    const before = snapshot(dir);
    expect([...before.keys()].some((k) => k.endsWith("pre-import.sqlite"))).toBe(true);

    const older = MIGRATIONS.slice(0, -1);
    const r = await openWithRecovery({ dataDir: dir, now: 3_000, log: quietLog, migrations: older });
    expect(r.result).toEqual({ kind: "newerData", dataVersion: LATEST_VERSION, latestVersion: LATEST_VERSION - 1 });
    // The working database is empty, in memory and refuses every write.
    expect(r.db.memory).toBe(true);
    expect(loadAll(r.db)).toEqual([]);
    expect(() => {
      applyChangeSet(r.db, { upserts: [makeTask({ titleMd: "x" })], removals: [] });
    }).toThrow();
    r.db.close();

    expect(snapshot(dir)).toEqual(before);
    expect(readdirSync(dir).some((n) => n.startsWith("data.restore.tmp") || n.startsWith("recovered-"))).toBe(false);
    expect(existsSync(join(dir, "damaged"))).toBe(false);
  });
});

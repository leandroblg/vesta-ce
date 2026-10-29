/** Prepares data folders before launch: rows, backups, corruption (quickstart.md). */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import type { Reminder } from "../../../src/domain/reminder";
import type { Task } from "../../../src/domain/task";
import { registerSearchFunctions } from "../../../src/main/db/search-functions";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../../src/main/db/migrations");
export const DAY = 86_400_000;

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
/** The schema version a fully migrated database has: the highest migration number (002 T021). */
export const SCHEMA_VERSION = Math.max(...MIGRATION_FILES.map((f) => Number.parseInt(f, 10)));

/** A database migrated up to `version` (default: fully migrated), holding `rows`. */
function createDatabase(path: string, rows: readonly Task[], version = SCHEMA_VERSION): void {
  const db = new Database(path);
  // Inserts fire the 006 search triggers, which call these functions (006 T014).
  registerSearchFunctions(db);
  db.pragma("journal_mode = WAL");
  for (const file of MIGRATION_FILES.filter((f) => Number.parseInt(f, 10) <= version)) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  db.prepare("insert into schema_version (version) values (?)").run(version);
  // By column name, only the columns this schema version has (older versions lack the 003 alert columns).
  const columns = new Set((db.prepare("pragma table_info(tasks)").all() as { name: string }[]).map((c) => c.name));
  const ordered = [...rows].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  db.transaction(() => {
    for (const r of ordered) {
      const params = Object.fromEntries(Object.entries(taskColumns(r)).filter(([k]) => columns.has(k)));
      const keys = Object.keys(params);
      db.prepare(`insert into tasks (${keys.join(", ")}) values (${keys.map((k) => `@${k}`).join(", ")})`).run(params);
    }
  })();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

/** A Task as `tasks` columns (001 and 003 data-model.md). */
function taskColumns(t: Task): Record<string, string | number | null> {
  return {
    id: t.id,
    parent_id: t.parentId,
    title_md: t.titleMd,
    position: t.position,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    done_at: t.doneAt,
    deleted_at: t.deletedAt,
    collapsed: t.collapsed ? 1 : 0,
    prev_sibling_id: t.prevSiblingId,
    next_sibling_id: t.nextSiblingId,
    left_with_id: t.leftWithId,
    alert_period_override_min: t.alertOverrideMin,
    stale_base_at: t.staleBaseAt,
    stale_since: t.staleSince,
    was_stale: t.wasStale ? 1 : 0,
    last_blink_at: t.lastBlinkAt,
    first_blink_count: t.firstBlinkCount,
    manually_positioned: t.manuallyPositioned ? 1 : 0,
    last_signal_at: t.lastSignalAt,
    details_md: t.detailsMd,
    reschedule_for_min: t.rescheduleForMin,
    kept_done_at: t.keptDoneAt,
  };
}

let seq = 0;
export function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  const now = Date.now();
  return {
    id: randomUUID(),
    parentId: null,
    titleMd: `Seeded ${String(seq)}`,
    position: seq,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    deletedAt: null,
    collapsed: false,
    prevSiblingId: null,
    nextSiblingId: null,
    leftWithId: null,
    keptDoneAt: null,
    alertOverrideMin: null,
    staleBaseAt: overrides.createdAt ?? now,
    staleSince: null,
    wasStale: false,
    lastBlinkAt: null,
    firstBlinkCount: null,
    manuallyPositioned: false,
    lastSignalAt: null,
    detailsMd: "",
    rescheduleForMin: null,
    ...overrides,
  };
}

/**
 * A stale task seeded as the alert engine would leave it after its first blink: created 2 days ago,
 * stale since 1 day ago (default 24 h period), blinked just now (004 T016).
 */
export function staleTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  const createdAt = overrides.createdAt ?? now - 2 * DAY;
  return task({ createdAt, staleSince: createdAt + DAY, wasStale: true, firstBlinkCount: 1, lastBlinkAt: now, ...overrides });
}

export function seedTasks(dataDir: string, rows: readonly Task[]): void {
  mkdirSync(dataDir, { recursive: true });
  createDatabase(join(dataDir, "data.sqlite"), rows);
}

/**
 * The data folder a previous release left behind: a database at an older schema version, for example
 * version 1 as written by the feature 001 build (same migration files, so the same schema).
 */
export function seedTasksAtVersion(dataDir: string, rows: readonly Task[], version: number): void {
  mkdirSync(dataDir, { recursive: true });
  createDatabase(join(dataDir, "data.sqlite"), rows, version);
}

/**
 * A stored file (005 data-model.md): the file in <data folder>/assets and its `assets` row, in a database that
 * seedTasks created (or an empty one). Returns the markdown reference, `assets/<sha256>[.<ext>]`.
 */
export function seedAsset(dataDir: string, bytes: Uint8Array, ext: string, mimeType = "application/octet-stream"): string {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const name = ext === "" ? sha : `${sha}.${ext}`;
  mkdirSync(join(dataDir, "assets"), { recursive: true });
  writeFileSync(join(dataDir, "assets", name), bytes);
  const path = join(dataDir, "data.sqlite");
  if (!existsSync(path)) seedTasks(dataDir, []);
  const db = new Database(path);
  registerSearchFunctions(db);
  try {
    db.prepare("insert or ignore into assets (sha256, ext, mime_type, size, created_at) values (?, ?, ?, ?, ?)").run(
      sha,
      ext,
      mimeType,
      bytes.length,
      Date.now(),
    );
    db.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  return `assets/${name}`;
}

export function writeLatestJson(dataDir: string, writtenAt: number, schemaVersion = SCHEMA_VERSION): void {
  mkdirSync(join(dataDir, "backups"), { recursive: true });
  writeFileSync(join(dataDir, "backups", "latest.json"), JSON.stringify({ writtenAt, schemaVersion }));
}

export function writeBackup(dataDir: string, rows: readonly Task[], writtenAt: number): void {
  mkdirSync(join(dataDir, "backups"), { recursive: true });
  createDatabase(join(dataDir, "backups", "latest.sqlite"), rows);
  writeLatestJson(dataDir, writtenAt);
}

export type CorruptMode = "truncate" | "random" | "badPage";

/** Damages a database file so it fails to open or fails `integrity_check`. */
export function corrupt(file: string, mode: CorruptMode): void {
  if (mode === "truncate") {
    truncateSync(file, 100);
    return;
  }
  if (mode === "random") {
    writeFileSync(file, randomBytes(64 * 1024));
    return;
  }
  // badPage: keep the header, overwrite the rest so pages fail the check.
  const buf = readFileSync(file);
  const damaged = Buffer.concat([buf.subarray(0, 100), randomBytes(Math.max(buf.length - 100, 8192))]);
  writeFileSync(file, damaged);
}

let reminderSeq = 0;
export function reminder(overrides: Partial<Reminder> = {}): Reminder {
  reminderSeq += 1;
  const now = Date.now();
  return {
    id: randomUUID(),
    textMd: `Reminder ${String(reminderSeq)}`,
    position: reminderSeq,
    createdAt: now,
    updatedAt: now,
    doneAt: null,
    deletedAt: null,
    keptDoneAt: null,
    prevSiblingId: null,
    nextSiblingId: null,
    ...overrides,
  };
}

/** Opens the data folder's database, creating a fully migrated one (no tasks) when missing. */
function openSeeded(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, "data.sqlite");
  if (!existsSync(path)) createDatabase(path, []);
  const db = new Database(path);
  registerSearchFunctions(db);
  return db;
}

/** 008: adds tasks to an existing (or new) data folder, for example after seedAsset made the database. */
export function addTasks(dataDir: string, rows: readonly Task[]): void {
  const db = openSeeded(dataDir);
  const ordered = [...rows].sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  db.transaction(() => {
    for (const r of ordered) {
      const params = taskColumns(r);
      const keys = Object.keys(params);
      db.prepare(`insert into tasks (${keys.join(", ")}) values (${keys.map((k) => `@${k}`).join(", ")})`).run(params);
    }
  })();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

export function seedReminders(dataDir: string, rows: readonly Reminder[]): void {
  const db = openSeeded(dataDir);
  // By column name, only the columns this schema version has (018 added kept_done_at).
  const columns = new Set((db.prepare("pragma table_info(reminders)").all() as { name: string }[]).map((c) => c.name));
  const names: [string, keyof Reminder][] = [
    ["id", "id"],
    ["text_md", "textMd"],
    ["position", "position"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
    ["done_at", "doneAt"],
    ["deleted_at", "deletedAt"],
    ["prev_sibling_id", "prevSiblingId"],
    ["next_sibling_id", "nextSiblingId"],
    ["kept_done_at", "keptDoneAt"],
  ];
  const used = names.filter(([c]) => columns.has(c));
  const insert = db.prepare(`insert into reminders (${used.map(([c]) => c).join(", ")}) values (${used.map(([, k]) => `@${k}`).join(", ")})`);
  db.transaction(() => {
    for (const r of rows) insert.run(Object.fromEntries(used.map(([, k]) => [k, r[k]])));
  })();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

/**
 * Writes raw `settings` values as stored text (so unreadable values can be seeded); `null` deletes the row.
 * For example `seedSettings(dir, { alertPeriodMin: null, reblinkIntervalMin: "abc" })`.
 */
export function seedSettings(dataDir: string, values: Readonly<Record<string, string | null>>): void {
  const db = openSeeded(dataDir);
  const put = db.prepare("insert or replace into settings (key, value, updated_at) values (?, ?, ?)");
  const remove = db.prepare("delete from settings where key = ?");
  db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) remove.run(key);
      else put.run(key, value, Date.now());
    }
  })();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

/** Writes one `settings` row, for example `seedSetting(dir, "remindersCollapsed", true)`. */
export function seedSetting(dataDir: string, key: string, value: unknown): void {
  const db = openSeeded(dataDir);
  db.prepare("insert or replace into settings (key, value, updated_at) values (?, ?, ?)").run(key, JSON.stringify(value), Date.now());
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

const SEARCH_WORDS = ["report", "invoice", "passport", "garden", "Café", "résumé", "meeting", "budget", "Ação", "travel", "dentist", "quarterly"];

function searchDetails(i: number): string {
  const w = (k: number) => SEARCH_WORDS[(i + k) % SEARCH_WORDS.length] ?? "word";
  const para = `Notes about **${w(1)}** and *${w(2)}* with \`code ${String(i)}\`, a [link](https://example.com/${String(i)}) and ==${w(3)}==.`;
  const table = `| Item | Qty |\n| --- | --- |\n| ${w(4)} | ${String(i % 7)} |`;
  let md = [`## ${w(0)} ${String(i)}`, para, table, `- [ ] call about ${w(5)}`, `> ${w(7)} quoted`].join("\n\n");
  while (md.length < 2000) md += `\n\n${para}`;
  return md;
}

/**
 * The 006 research §5 data set: 1,000 active tasks with about 2 KB of formatted details, 1,000 Archive and
 * Trash items and 200 reminders. With `version` (for example 4), the database is left at that schema
 * version, as a release before search wrote it (quickstart 17a).
 */
export function seedSearchSet(dataDir: string, options: { version?: number } = {}): void {
  const now = Date.now();
  const rows: Task[] = [];
  for (let i = 0; i < 1000; i++) {
    rows.push(task({ titleMd: `Task **${String(i)}** ${SEARCH_WORDS[i % SEARCH_WORDS.length] ?? ""}`, detailsMd: searchDetails(i), position: i + 1 }));
  }
  for (let i = 0; i < 1000; i++) {
    const gone = i % 2 === 0 ? { doneAt: now - i * 1000 } : { deletedAt: now - i * 1000 };
    rows.push(task({ titleMd: `Old ${String(i)} ${SEARCH_WORDS[(i + 3) % SEARCH_WORDS.length] ?? ""}`, detailsMd: searchDetails(i + 5), ...gone }));
  }
  mkdirSync(dataDir, { recursive: true });
  createDatabase(join(dataDir, "data.sqlite"), rows, options.version ?? SCHEMA_VERSION);
  seedReminders(
    dataDir,
    Array.from({ length: 200 }, (_, i) => reminder({ textMd: `Remember **${SEARCH_WORDS[i % SEARCH_WORDS.length] ?? ""}** ${String(i)}`, position: i + 1 })),
  );
}

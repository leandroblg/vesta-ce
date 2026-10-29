/** Hand-written SQL migrations with a schema_version table (PRD B2). */
import type Database from "better-sqlite3";
import m001 from "./migrations/001_init.sql?raw";
import m002 from "./migrations/002_reminders.sql?raw";
import m003 from "./migrations/003_aging_alerts.sql?raw";
import m004 from "./migrations/004_markdown_editor.sql?raw";
import m005 from "./migrations/005_search.sql?raw";
import m006 from "./migrations/006_settings.sql?raw";
import m007 from "./migrations/007_logs_updates.sql?raw";
import m008 from "./migrations/008_security.sql?raw";
import m009 from "./migrations/009_editor.sql?raw";
import m010 from "./migrations/010_palette.sql?raw";
import m011 from "./migrations/011_task_events.sql?raw";
import m012 from "./migrations/012_release_prep.sql?raw";

export interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: m001 },
  { version: 2, sql: m002 },
  { version: 3, sql: m003 },
  { version: 4, sql: m004 },
  { version: 5, sql: m005 },
  { version: 6, sql: m006 },
  { version: 7, sql: m007 },
  { version: 8, sql: m008 },
  { version: 9, sql: m009 },
  { version: 10, sql: m010 },
  { version: 11, sql: m011 },
  { version: 12, sql: m012 },
];

export const LATEST_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

export function currentVersion(db: Database.Database): number {
  const table = db.prepare("select name from sqlite_master where type = 'table' and name = 'schema_version'").get();
  if (table === undefined) return 0;
  const row = db.prepare("select version from schema_version limit 1").get() as { version: number } | undefined;
  return row?.version ?? 0;
}

export function needsUpgrade(db: Database.Database, migrations: readonly Migration[] = MIGRATIONS): boolean {
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  return currentVersion(db) < latest;
}

/** Applies every pending migration in one transaction; on error nothing changes (constitution VI). */
export function migrate(db: Database.Database, migrations: readonly Migration[] = MIGRATIONS): void {
  const from = currentVersion(db);
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;
  const run = db.transaction(() => {
    for (const m of pending) db.exec(m.sql);
    const to = pending[pending.length - 1]?.version ?? from;
    db.prepare("delete from schema_version").run();
    db.prepare("insert into schema_version (version) values (?)").run(to);
  });
  run();
}

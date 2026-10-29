import { chmodSync } from "node:fs";
import Database from "better-sqlite3";
import { registerSearchFunctions } from "./search-functions";

/** Opens the database with the PRD B2 / research.md §3 settings. */
export function openDatabase(path: string, options: { readonly?: boolean } = {}): Database.Database {
  const db = new Database(path, { readonly: options.readonly ?? false, fileMustExist: options.readonly ?? false });
  // 010 FR-023 (L9): owner-only before the WAL exists, so SQLite gives -wal and -shm the same mode.
  if (path !== ":memory:" && process.platform !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // a file system without modes: the start-up folder check logs it once
    }
  }
  if (!options.readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    // 010 FR-024 (L15): deleted and overwritten content is zeroed, never left in free pages.
    db.pragma("secure_delete = ON");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 2000");
  // The search triggers call these (006 research §4).
  registerSearchFunctions(db);
  if (!options.readonly) applySearchSecureDelete(db);
  return db;
}

/** 010 FR-024 (L15): FTS5 removes a deleted row's terms at delete time instead of leaving tombstones. Idempotent. */
export function applySearchSecureDelete(db: Database.Database): void {
  const table = db.prepare("select name from sqlite_master where type = 'table' and name = 'search_fts'").get();
  if (table === undefined) return;
  const current = db.prepare("select v from search_fts_config where k = 'secure-delete'").get() as { v: number } | undefined;
  if (current?.v === 1) return;
  db.exec("insert into search_fts(search_fts, rank) values ('secure-delete', 1)");
}

/**
 * 010 FR-024 (L15), once after migrations: the search index's secure deletion, and incremental vacuum so the purge
 * can release free pages (switching it on an existing file takes one VACUUM, after the migration backup).
 */
export function afterMigrate(db: Database.Database): void {
  applySearchSecureDelete(db);
  const mode = db.pragma("auto_vacuum", { simple: true }) as number;
  if (mode !== 2) {
    db.pragma("auto_vacuum = INCREMENTAL");
    db.exec("VACUUM");
  }
}

/** 010 FR-024 (L15), after every purge run: purged text leaves the index, free pages are released, the WAL is truncated. */
export function maintainAfterPurge(db: Database.Database): void {
  try {
    db.exec("insert into search_fts(search_fts) values ('optimize')");
  } catch {
    // no search index yet (a fresh database before 005's migration ran)
  }
  db.pragma("incremental_vacuum");
  db.pragma("wal_checkpoint(TRUNCATE)");
}

/** True only when `PRAGMA integrity_check` returns a single `ok` row. Never throws. */
export function integrityOk(db: Database.Database): boolean {
  try {
    const rows = db.pragma("integrity_check") as { integrity_check: string }[];
    return rows.length === 1 && rows[0]?.integrity_check === "ok";
  } catch {
    return false;
  }
}

/** Opens a file and checks it; false for unreadable, non-database or damaged files. */
export function fileIntegrityOk(path: string): boolean {
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    return integrityOk(db);
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

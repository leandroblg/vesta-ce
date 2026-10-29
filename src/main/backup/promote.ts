/**
 * The pre-import backup becomes the latest backup when the Undo import offer ends (008 research §6; FR-037a).
 * The database file is renamed first, then its info file, so a crash between the two never pairs older data
 * with a newer time. Its locks then replace the old latest's.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import type Database from "better-sqlite3";
import { recordLocks } from "../assets/locks";
import { fileIntegrityOk } from "../db/connection";
import { errorMessage, type Logger } from "../log";
import { backupFile, backupInfoFile } from "./backup";

type Log = Pick<Logger, "warn" | "error" | "info">;

/** SQLite's side files of a database file; a stale one must never sit next to another database. */
function removeSideFiles(file: string): void {
  for (const suffix of ["-wal", "-shm", ".tmp-wal", ".tmp-shm"]) rmSync(`${file}${suffix}`, { force: true });
}

function moveFiles(dataDir: string): void {
  removeSideFiles(backupFile(dataDir, "latest"));
  renameSync(backupFile(dataDir, "pre-import"), backupFile(dataDir, "latest"));
  removeSideFiles(backupFile(dataDir, "pre-import"));
  if (existsSync(backupInfoFile(dataDir, "pre-import"))) renameSync(backupInfoFile(dataDir, "pre-import"), backupInfoFile(dataDir, "latest"));
}

export function promotePreImport(db: Database.Database, dataDir: string, log: Log): void {
  if (!existsSync(backupFile(dataDir, "pre-import"))) return;
  moveFiles(dataDir);
  log.info("backup.pre-import-promoted");
  try {
    recordLocks(db, dataDir, log, "backups/latest.sqlite");
  } catch (err) {
    log.error("backup.locks-failed", { message: errorMessage(err) });
  }
}

/**
 * At start, before the 001 plan: a pre-import backup left by a crash or a quit during the offer is promoted if
 * it is valid, else deleted. Returns true when it was promoted, so the caller rebuilds the locks.
 */
export function settlePreImportAtStart(dataDir: string, log: Log): boolean {
  const file = backupFile(dataDir, "pre-import");
  if (!existsSync(file)) {
    rmSync(backupInfoFile(dataDir, "pre-import"), { force: true });
    return false;
  }
  if (fileIntegrityOk(file)) {
    moveFiles(dataDir);
    log.warn("backup.pre-import-promoted-at-start");
    return true;
  }
  rmSync(file, { force: true });
  removeSideFiles(file);
  rmSync(backupInfoFile(dataDir, "pre-import"), { force: true });
  log.warn("backup.pre-import-invalid-deleted");
  return false;
}

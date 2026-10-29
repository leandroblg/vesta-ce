/**
 * Integrity-checked online backup into backups/latest.sqlite (FR-041, FR-041a, FR-041b, research.md §7), or
 * backups/pre-import.sqlite before an import (008 FR-036a, research §4). A backup is replaced only by a verified copy.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { fileIntegrityOk, integrityOk } from "../db/connection";
import { currentVersion } from "../db/migrate";
import { faultActive } from "../faults";
import { errorMessage, type Logger } from "../log";
import { recordLocks } from "../assets/locks";

export type BackupResult = { kind: "written"; at: number } | { kind: "failed"; message: string } | { kind: "damaged" };

export interface LatestInfo {
  writtenAt: number;
  schemaVersion: number;
}

export type BackupName = "latest" | "pre-import";

export const backupDir = (dataDir: string) => join(dataDir, "backups");
export const backupFile = (dataDir: string, name: BackupName = "latest") => join(backupDir(dataDir), `${name}.sqlite`);
export const backupInfoFile = (dataDir: string, name: BackupName = "latest") => join(backupDir(dataDir), `${name}.json`);
/** The backup's path relative to the data folder, as `backup_assets.backup` stores it (005 FR-032a). */
export const backupRef = (name: BackupName) => `backups/${name}.sqlite`;

export function readLatestJson(dataDir: string): LatestInfo | null {
  return readBackupJson(dataDir, "latest");
}

export function readBackupJson(dataDir: string, name: BackupName): LatestInfo | null {
  try {
    const parsed = JSON.parse(readFileSync(backupInfoFile(dataDir, name), "utf8")) as Partial<LatestInfo>;
    if (typeof parsed.writtenAt !== "number" || typeof parsed.schemaVersion !== "number") return null;
    return { writtenAt: parsed.writtenAt, schemaVersion: parsed.schemaVersion };
  } catch {
    return null;
  }
}

export async function writeBackup(
  db: Database.Database,
  dataDir: string,
  now: number,
  log?: Pick<Logger, "warn" | "error" | "info">,
  name: BackupName = "latest",
): Promise<BackupResult> {
  if (!integrityOk(db) || faultActive("damaged")) return { kind: "damaged" };
  const dir = backupDir(dataDir);
  const tmp = join(dir, `${name}.sqlite.tmp`);
  try {
    mkdirSync(dir, { recursive: true });
    rmSync(tmp, { force: true });
    if (faultActive(name === "latest" ? "backup" : "pre-import-backup")) throw new Error(`VESTA_FAULT=${name} backup`);
    await db.backup(tmp);
    if (process.platform !== "win32") chmodSync(tmp, 0o600); // 010 L9: owner-only
    if (!fileIntegrityOk(tmp)) throw new Error("backup copy failed its integrity check");
    renameSync(tmp, backupFile(dataDir, name));
    const info: LatestInfo = { writtenAt: now, schemaVersion: currentVersion(db) };
    const infoFile = backupInfoFile(dataDir, name);
    writeFileSync(`${infoFile}.tmp`, JSON.stringify(info), { mode: 0o600 });
    renameSync(`${infoFile}.tmp`, infoFile);
    // 005 FR-032a: the stored files this backup references are locked; a failure here never fails the backup.
    if (log !== undefined) {
      try {
        recordLocks(db, dataDir, log, backupRef(name));
      } catch (err) {
        log.error("backup.locks-failed", { message: errorMessage(err) });
      }
    }
    return { kind: "written", at: now };
  } catch (err) {
    rmSync(tmp, { force: true });
    return { kind: "failed", message: errorMessage(err) };
  }
}

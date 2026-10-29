/** The backup locks and the "removed from system" tags (005 FR-032a, data-model.md `backup_assets`). */
import type Database from "better-sqlite3";
import type { Lock } from "../../domain/backup-locks";
import { assetPath } from "../../domain/purge";

export function listLocks(db: Database.Database): Lock[] {
  return db.prepare("select backup, path from backup_assets order by backup, path").all() as Lock[];
}

/** Replaces every lock row; call inside a transaction. */
export function replaceLocks(db: Database.Database, locks: readonly Lock[]): void {
  db.prepare("delete from backup_assets").run();
  const insert = db.prepare("insert or ignore into backup_assets (backup, path) values (?, ?)");
  for (const l of locks) insert.run(l.backup, l.path);
}

/** Tags an asset found unreferenced while a backup lists it; the first tag time is kept. */
export function tagAsset(db: Database.Database, sha256: string, now: number): void {
  db.prepare("update assets set removed_at = ? where sha256 = ? and removed_at is null").run(now, sha256);
}

/** The paths of tagged assets. */
export function taggedAssets(db: Database.Database): string[] {
  return (
    db.prepare("select sha256, ext from assets where removed_at is not null").all() as { sha256: string; ext: string }[]
  ).map(assetPath);
}

export function hasLockTable(db: Database.Database): boolean {
  return db.prepare("select 1 from sqlite_master where type = 'table' and name = 'backup_assets'").get() !== undefined;
}

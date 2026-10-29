// Applying the backup locks (005 FR-032a): after each valid backup and after a restore, and the asset step of
// the hourly purge. Rows change in one transaction; files are unlinked only after it has committed, so a crash
// can leave a file without a row (removed by the next purge), never a row without its file.
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterBackup, onUnreferenced } from "../../domain/backup-locks";
import { assetRefs } from "../../domain/markdown/assets";
import { assetPath, selectUnreferencedAssets } from "../../domain/purge";
import { deleteAssets, listAssets } from "../db/assets-repo";
import { hasLockTable, listLocks, replaceLocks, tagAsset, taggedAssets } from "../db/backup-locks-repo";
import { loadReminders } from "../db/reminders-repo";
import { loadAll } from "../db/tasks-repo";
import { faultActive } from "../faults";
import { errorMessage, type Logger } from "../log";

type Log = Pick<Logger, "warn" | "error" | "info">;

const shaOf = (path: string): string => path.slice("assets/".length, "assets/".length + 64);

/** Every stored-file reference in a database file (a backup), read-only. */
export function refsInDatabase(file: string): string[] {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const refs = new Set<string>();
    const tasks = db.prepare("select * from tasks").all() as { title_md: string; details_md?: string }[];
    for (const t of tasks)
      for (const ref of [...assetRefs(t.title_md), ...assetRefs(t.details_md ?? "")]) refs.add(ref);
    const hasReminders = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'reminders'").get();
    if (hasReminders !== undefined) {
      for (const r of db.prepare("select text_md from reminders").all() as { text_md: string }[]) {
        for (const ref of assetRefs(r.text_md)) refs.add(ref);
      }
    }
    return [...refs];
  } finally {
    db.close();
  }
}

function unlinkAll(dir: string, paths: readonly string[], log: Log): void {
  for (const path of paths) {
    try {
      unlinkSync(join(dir, path));
    } catch (err) {
      log.warn("asset.unlink-failed", { path, message: errorMessage(err) });
    }
  }
}

/**
 * After a valid backup (or a restore): its locks replace the old ones, and tagged files no lock lists go.
 * `backup` names which backup was written (008: `backups/pre-import.sqlite` too); other backups keep theirs.
 */
export function recordLocks(db: Database.Database, dataDir: string, log: Log, backup = "backups/latest.sqlite"): void {
  if (!hasLockTable(db)) return;
  const backups = existsSync(join(dataDir, "backups"))
    ? readdirSync(join(dataDir, "backups"))
        .filter((n) => n.endsWith(".sqlite"))
        .map((n) => `backups/${n}`)
    : [];
  const refs = backups.includes(backup) ? refsInDatabase(join(dataDir, backup)) : [];
  const out = afterBackup({ backup, refs, existingBackups: backups, locks: listLocks(db), tagged: taggedAssets(db) });
  db.transaction(() => {
    replaceLocks(db, out.locks);
    deleteAssets(db, out.deleteNow.map(shaOf));
  })();
  unlinkAll(dataDir, out.deleteNow, log);
  if (out.deleteNow.length > 0) log.info("asset.deleted-after-backup", { count: out.deleteNow.length });
}

/** The asset step of the purge (FR-032, FR-032a). */
export function purgeAssets(db: Database.Database, dataDir: string, now: number, log: Log): void {
  const assets = listAssets(db);
  const unreferenced = selectUnreferencedAssets(assets, loadAll(db), loadReminders(db));
  const locks = listLocks(db);
  const remove = unreferenced.filter((path) => onUnreferenced(path, locks) === "delete");
  const tag = unreferenced.filter((path) => onUnreferenced(path, locks) === "tag");
  db.transaction(() => {
    deleteAssets(db, remove.map(shaOf));
    for (const path of tag) tagAsset(db, shaOf(path), now);
  })();
  if (faultActive("asset-unlink")) throw new Error("VESTA_FAULT=asset-unlink");
  unlinkAll(dataDir, remove, log);
  // Files with no row and no lock, left by a crash or an interrupted write.
  const folder = join(dataDir, "assets");
  if (!existsSync(folder)) return;
  const known = new Set([...listAssets(db).map(assetPath), ...listLocks(db).map((l) => l.path)]);
  const orphans = readdirSync(folder)
    .map((name) => `assets/${name}`)
    .filter((path) => !known.has(path));
  unlinkAll(dataDir, orphans, log);
}

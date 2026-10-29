// Backup locks (005 FR-032a, user decision Q106): which stored files each backup references, so the purge
// never deletes a file a backup still needs. Pure; main applies the results in transactions.
import { isAssetRef } from "./markdown/assets";
import { hashOfRef } from "./purge";

export interface Lock {
  /** The backup's path relative to the data folder, e.g. `backups/latest.sqlite`. */
  backup: string;
  /** The stored file's path relative to the data folder, `assets/<sha256>[.<ext>]`. */
  path: string;
}

export interface AfterBackupInput {
  backup: string;
  /** The stored-file references found in that backup's database. */
  refs: readonly string[];
  /** The backups that exist now. */
  existingBackups: readonly string[];
  /** The current locks. */
  locks: readonly Lock[];
  /** Files tagged "removed from system" (unreferenced, but locked when the purge ran). */
  tagged: readonly string[];
}

/** After a valid backup: its locks replaced by its refs, locks of vanished backups dropped, and the tagged files no lock lists any more. */
export function afterBackup(input: AfterBackupInput): { locks: Lock[]; deleteNow: string[] } {
  const existing = new Set(input.existingBackups);
  const kept = input.locks.filter((l) => l.backup !== input.backup && existing.has(l.backup));
  const own = [...new Set(input.refs.filter(isAssetRef))].map((path) => ({ backup: input.backup, path }));
  const locks = [...kept, ...own];
  // By hash (008 research §9): a lock under another extension still holds the stored file.
  const listed = new Set(locks.map((l) => hashOfRef(l.path)));
  return { locks, deleteNow: input.tagged.filter((path) => !listed.has(hashOfRef(path))) };
}

/** An unreferenced file found by the purge: deleted at once, or tagged while a backup lists it. */
export function onUnreferenced(path: string, locks: readonly Lock[]): "delete" | "tag" {
  return locks.some((l) => hashOfRef(l.path) === hashOfRef(path)) ? "tag" : "delete";
}

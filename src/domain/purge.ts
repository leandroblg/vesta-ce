/** Stored files and the purge (005 FR-032); 018 moved the Trash rule to cleanup.ts. */
import type { Reminder } from "./reminder";
import type { Task } from "./task";
import { assetRefs } from "./markdown/assets";

/** The hash of a stored-file reference `assets/<sha256>[.<ext>]`: a stored file's identity (008 research §9). */
export function hashOfRef(ref: string): string {
  return ref.slice("assets/".length, "assets/".length + 64);
}

/** The stored-file path of an `assets` row (data-model.md "Link to `assets`"). */
export function assetPath(asset: { sha256: string; ext: string }): string {
  return asset.ext === "" ? `assets/${asset.sha256}` : `assets/${asset.sha256}.${asset.ext}`;
}

/**
 * Stored files no task, subtask or reminder references, in any state (005 FR-032): every reference is scanned
 * at each run, so a file shared by several items stays while one of them still references it.
 */
export function selectUnreferencedAssets(
  assets: readonly { sha256: string; ext: string }[],
  tasks: readonly Task[],
  reminders: readonly Reminder[],
): string[] {
  // By hash (008 research §9): a reference with another extension still uses the stored file.
  const used = new Set<string>();
  for (const t of tasks) for (const ref of [...assetRefs(t.titleMd), ...assetRefs(t.detailsMd)]) used.add(hashOfRef(ref));
  for (const r of reminders) for (const ref of assetRefs(r.textMd)) used.add(hashOfRef(ref));
  return assets.filter((a) => !used.has(a.sha256)).map(assetPath);
}

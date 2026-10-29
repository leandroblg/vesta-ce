/**
 * 016 FR-016b (PRD Q245; research §10): a stored file is read, served, opened or shown only from Vesta's own
 * stored-files folder. The path is built from the reference's hash and the database row's extension only; a file
 * that is a link resolving outside `<data>/assets` is refused.
 */
import { realpathSync } from "node:fs";
import { join, sep } from "node:path";

/** The stored file's path when it exists and resolves inside `<dir>/assets`, else null. */
export function storedFilePath(dir: string, file: string): string | null {
  const folder = join(dir, "assets");
  const path = join(folder, file);
  try {
    const real = realpathSync(path);
    const root = realpathSync(folder);
    return real.startsWith(root + sep) ? path : null;
  } catch {
    return null;
  }
}

/** The stored file exists, but resolves outside the folder (a link leading out): worth a warning. */
export function leadsOutside(dir: string, file: string): boolean {
  try {
    realpathSync(join(dir, "assets", file));
  } catch {
    return false;
  }
  return storedFilePath(dir, file) === null;
}

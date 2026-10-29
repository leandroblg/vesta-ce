/** Data folder per PRD B2 (FR-038, FR-038a; research.md §8). */
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface AppLike {
  isPackaged: boolean;
  getPath(name: "userData"): string;
}

/** VESTA_DATA_DIR overrides the folder only in unpackaged (development and test) builds. */
export function resolveDataDir(app: AppLike): string {
  const override = process.env["VESTA_DATA_DIR"];
  if (!app.isPackaged && override !== undefined && override !== "") return override;
  return app.getPath("userData");
}

export interface DataDirOptions {
  platform?: NodeJS.Platform;
  log?: { warn: (event: string, fields: Record<string, unknown>) => void };
  /** Injected for tests. */
  chmod?: (path: string, mode: number) => void;
}

/**
 * Creates the folder when missing, owner-only (010 FR-023, L9), and tightens an existing folder's mode at every
 * start. Returns true when it was created (a first run).
 */
export function ensureDataDir(dir: string, options: DataDirOptions = {}): boolean {
  const created = !existsSync(dir);
  if (created) mkdirSync(dir, { recursive: true, mode: 0o700 });
  tightenMode(dir, 0o700, options);
  return created;
}

/**
 * Drops every permission outside `mask` (group and other), keeping the owner's bits as they are, so a folder the user
 * made read-only on purpose stays read-only (FR-038a) while a wider one becomes owner-only. Not on Windows; a file
 * system without modes is logged once by the caller and never stops the start.
 */
export function tightenMode(path: string, mask: number, options: DataDirOptions = {}): void {
  if ((options.platform ?? process.platform) === "win32") return;
  try {
    const current = statSync(path).mode & 0o777;
    const target = current & mask;
    if (target !== current) (options.chmod ?? chmodSync)(path, target);
  } catch (err) {
    options.log?.warn("data-dir.chmod-failed", { message: err instanceof Error ? err.message : String(err) });
  }
}

/** Write test: create and delete a temp file (FR-038a). */
export function isWritable(dir: string): boolean {
  const probe = join(dir, `.write-test-${String(process.pid)}`);
  try {
    writeFileSync(probe, "");
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * When the data folder cannot be written (FR-038a), the app still shows the user's data from a copy in
 * the system temp folder, opened query-only: every change then fails as "Changes are not saved".
 */
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase } from "../db/connection";
import { migrate } from "../db/migrate";
import { errorMessage, type Logger } from "../log";

export interface ReadOnlyOptions {
  /** `app.getPath("temp")`: never a world-writable folder with a fixed name (010 FR-008, M3). */
  tempRoot: string;
  /** Receives the folder, so main removes it at quit. */
  register: (dir: string) => void;
  uid?: number | null;
}

/** 010 FR-008 (M3): a temporary folder is used only when it is a directory, not a link, owned by the current user. */
export function assertOwnedDir(dir: string, uid: number | null): void {
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink()) throw new Error(`${dir} is a symbolic link`);
  if (!stat.isDirectory()) throw new Error(`${dir} is not a directory`);
  if (uid !== null && stat.uid !== uid) throw new Error(`${dir} is not owned by this user`);
}

const PID_FILE = "vesta.pid";

/** Marks a temporary folder as this process's, so a later start can tell a stale folder from a running instance's. */
export function markTempDir(dir: string, pid: number = process.pid): void {
  writeFileSync(join(dir, PID_FILE), String(pid), { mode: 0o600 });
}

/**
 * 010 FR-008 (M3): Chromium writes its profile after the process's last code has run, so a folder removed at quit
 * can come back as a shell of Chromium files (no user data: the read-only copy is gone). Every start sweeps the
 * folders of previous runs: owned by this user, not one of ours, and not marked by a process that is still alive.
 */
export function sweepTempDirs(
  tempRoot: string,
  keep: readonly string[],
  log: Pick<Logger, "warn" | "info">,
  options: { uid?: number | null; isAlive?: (pid: number) => boolean } = {},
): string[] {
  const uid = options.uid === undefined ? (process.getuid?.() ?? null) : options.uid;
  const isAlive =
    options.isAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
      }
    });
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(tempRoot);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!/^vesta-(?:profile|readonly)-/.test(name)) continue;
    const dir = join(tempRoot, name);
    if (keep.includes(dir)) continue;
    try {
      assertOwnedDir(dir, uid);
    } catch {
      continue;
    }
    const pid = readPid(join(dir, PID_FILE));
    if (pid !== null && (pid === process.pid || isAlive(pid))) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch (err) {
      log.warn("temp.remove-failed", { message: errorMessage(err) });
    }
  }
  if (removed.length > 0) log.info("temp.swept", { count: removed.length });
  return removed;
}

function readPid(path: string): number | null {
  try {
    const text = readFileSync(path, "utf8").trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  } catch {
    return null;
  }
}

/** Removes the registered temporary folders at quit; what the OS still holds is logged, not thrown. */
export function removeTempDirs(dirs: readonly string[], log: Pick<Logger, "warn">): void {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      log.warn("temp.remove-failed", { message: errorMessage(err) });
    }
  }
}

const ownerOnly = (path: string) => {
  if (process.platform !== "win32") chmodSync(path, 0o600);
};

export function openReadOnlyCopy(dataDir: string, log: Logger, options: ReadOnlyOptions): Database.Database {
  const source = join(dataDir, "data.sqlite");
  const dir = mkdtempSync(join(options.tempRoot, "vesta-readonly-"));
  assertOwnedDir(dir, options.uid === undefined ? (process.getuid?.() ?? null) : options.uid);
  markTempDir(dir);
  options.register(dir);
  const copy = join(dir, "data.sqlite");
  let db: Database.Database;
  try {
    if (!existsSync(source)) throw new Error("no data file");
    copyFileSync(source, copy);
    ownerOnly(copy);
    if (existsSync(`${source}-wal`)) {
      copyFileSync(`${source}-wal`, `${copy}-wal`);
      ownerOnly(`${copy}-wal`);
    }
    db = openDatabase(copy);
  } catch (err) {
    log.warn("data-dir.read-only-empty", { message: errorMessage(err) });
    db = openDatabase(":memory:");
  }
  migrate(db);
  db.pragma("query_only = ON");
  return db;
}

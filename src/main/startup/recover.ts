/**
 * Opens the database at start, carrying out the StartupPlan (FR-042, FR-042a, FR-043; research.md §7).
 * Nothing is ever deleted except the corrupt database after a successful restore and older damaged copies.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { planStartup, type StartupFacts } from "../../domain/startup";
import type { StartupResult } from "../../domain/startup-outcome";
import { backupFile, readLatestJson, writeBackup } from "../backup/backup";
import { fileIntegrityOk, integrityOk, openDatabase } from "../db/connection";
import { MIGRATIONS, currentVersion, migrate, type Migration } from "../db/migrate";
import { errorMessage, type Logger } from "../log";
import { recordLocks } from "../assets/locks";
import { settlePreImportAtStart } from "../backup/promote";

export interface RecoverOptions {
  dataDir: string;
  now: number;
  log: Logger;
  migrations?: readonly Migration[];
}

export interface Recovered {
  db: Database.Database;
  result: StartupResult;
}

/**
 * Vesta's own files and folders, plus Electron/Chromium's profile files that share the data folder.
 * Anything else is not referenced by the restored database in this feature and is set aside.
 */
// `assets`: the stored files the restored database references stay where they are (005 FR-032a).
const OWN = new Set(["backups", "logs", "damaged", "assets", "Session", "Crashpad", "Local State", "Dictionaries"]);
export function isOwnStructure(name: string): boolean {
  return (
    OWN.has(name) ||
    name.startsWith("recovered-") ||
    name.startsWith("data.restore.tmp") ||
    name.startsWith("Singleton") ||
    name.startsWith(".write-test-")
  );
}

function tryOpen(path: string): { db: Database.Database | null; ok: boolean; version: number } {
  try {
    const db = openDatabase(path);
    const ok = integrityOk(db);
    let version = 0;
    try {
      version = currentVersion(db);
    } catch {
      return { db, ok: false, version: 0 };
    }
    return { db, ok, version };
  } catch {
    return { db: null, ok: false, version: 0 };
  }
}

function versionOf(path: string): number | null {
  if (!fileIntegrityOk(path)) return null;
  const { db, version } = tryOpen(path);
  db?.close();
  return version;
}

/**
 * 017 FR-015a (PRD Q263): the schema version of a healthy data file newer than this build knows, else null. Read-only,
 * so the refusal changes nothing; a file that does not open or fails its integrity check takes the usual paths.
 */
function newerDataVersion(path: string, latestVersion: number): number | null {
  if (!existsSync(path)) return null;
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    if (!integrityOk(db)) return null;
    const version = currentVersion(db);
    return version > latestVersion ? version : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** The working database while newer data is refused: empty, in memory, and every write fails (Q263, Q267). */
function refusedDatabase(migrations: readonly Migration[]): Database.Database {
  const db = new Database(":memory:");
  migrate(db, migrations);
  db.pragma("query_only = ON");
  return db;
}

export async function openWithRecovery(options: RecoverOptions): Promise<Recovered> {
  const { dataDir, log } = options;
  // 017 FR-015a: data saved by a newer Vesta is refused before anything else, the pending pre-import backup's
  // promotion included, so no file of the data folder changes.
  const migrations = options.migrations ?? MIGRATIONS;
  const latestVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  const newer = newerDataVersion(join(dataDir, "data.sqlite"), latestVersion);
  if (newer !== null) return { db: refusedDatabase(migrations), result: { kind: "newerData", dataVersion: newer, latestVersion } };
  // 008 FR-037a: a pre-import backup left by a crash or quit during the Undo import offer.
  const promoted = settlePreImportAtStart(dataDir, log);
  const recovered = await openPlanned(options);
  if (promoted) {
    try {
      recordLocks(recovered.db, dataDir, log);
    } catch (err) {
      log.error("backup.locks-failed", { message: errorMessage(err) });
    }
  }
  return recovered;
}

async function openPlanned({ dataDir, now, log, migrations = MIGRATIONS }: RecoverOptions): Promise<Recovered> {
  const latestVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  const dataPath = join(dataDir, "data.sqlite");
  const backupPath = backupFile(dataDir);

  const dataExists = existsSync(dataPath);
  let opened = dataExists ? tryOpen(dataPath) : { db: null, ok: false, version: 0 };
  const backupExists = existsSync(backupPath);
  const backupVersion = backupExists ? versionOf(backupPath) : null;
  const facts: StartupFacts = {
    dataExists,
    dataOk: opened.ok,
    dataVersion: opened.version,
    latestVersion,
    upgradeFailed: false,
    backupExists,
    backupValid: backupVersion !== null && backupVersion <= latestVersion,
    backupAt: readLatestJson(dataDir)?.writtenAt ?? (backupExists ? statSync(backupPath).mtimeMs : null),
  };

  for (;;) {
    const plan = planStartup(facts);
    const steps = new Set(plan.steps);

    if (plan.result.kind === "newerData") {
      // Reached only if the file changed after the early check: still refused, the real file closed.
      opened.db?.close();
      return { db: refusedDatabase(migrations), result: plan.result };
    }
    if (plan.steps.length === 0 && opened.db !== null) return { db: opened.db, result: plan.result };

    if (steps.has("preUpgradeBackup") && opened.db !== null) {
      const backup = await writeBackup(opened.db, dataDir, now, log);
      if (backup.kind !== "written") {
        // Constitution VI: never migrate without a backup copy first.
        throw new Error(`pre-upgrade backup failed: ${backup.kind === "failed" ? backup.message : "data damaged"}`);
      }
      try {
        migrate(opened.db, migrations);
        log.info("db.upgraded", { to: latestVersion });
        return { db: opened.db, result: plan.result };
      } catch (err) {
        log.error("db.upgrade-failed", { message: errorMessage(err) });
        opened.db.close();
        opened = { db: null, ok: false, version: 0 };
        facts.upgradeFailed = true;
        continue;
      }
    }

    if (!dataExists && steps.has("migrate")) {
      const db = openDatabase(dataPath);
      migrate(db, migrations);
      return { db, result: plan.result };
    }

    opened.db?.close();
    opened = { db: null, ok: false, version: 0 };

    if (steps.has("restoreFromBackup")) {
      const restored = restoreFromBackup(dataDir, backupPath, migrations, now, log);
      if (restored === null) {
        facts.backupValid = false;
        continue;
      }
      log.warn("db.restored-from-backup", { backupAt: facts.backupAt, moved: restored.moved?.count ?? 0 });
      // FR-032a: the locks are rebuilt from the restored database.
      try {
        recordLocks(restored.db, dataDir, log);
      } catch (err) {
        log.error("backup.locks-failed", { message: errorMessage(err) });
      }
      return {
        db: restored.db,
        result: { kind: "restored", backupAt: facts.backupAt ?? 0, moved: restored.moved },
      };
    }

    // keepDamagedCopy + startEmpty
    const damagedPath = keepDamagedCopy(dataDir, now);
    log.error("db.unrecoverable", { damagedPath, backupExists });
    const db = openDatabase(dataPath);
    migrate(db, migrations);
    const result: StartupResult = plan.result.kind === "unrecoverable" ? { kind: "unrecoverable", damagedPath } : plan.result;
    return { db, result };
  }
}

function restoreFromBackup(
  dataDir: string,
  backupPath: string,
  migrations: readonly Migration[],
  now: number,
  log: Logger,
): { db: Database.Database; moved: { count: number; folder: string } | null } | null {
  const tmp = join(dataDir, "data.restore.tmp");
  try {
    rmSync(tmp, { force: true });
    copyFileSync(backupPath, tmp);
    const copy = openDatabase(tmp);
    try {
      migrate(copy, migrations); // FR-043: an older backup is upgraded after it is restored
    } finally {
      copy.close();
    }
  } catch (err) {
    log.error("db.backup-unusable", { message: errorMessage(err) });
    for (const f of readdirSync(dataDir)) if (f.startsWith("data.restore.tmp")) rmSync(join(dataDir, f), { force: true });
    return null;
  }

  rmSync(join(dataDir, "data.sqlite"), { force: true });
  const unreferenced = readdirSync(dataDir).filter((name) => !isOwnStructure(name));
  let moved: { count: number; folder: string } | null = null;
  if (unreferenced.length > 0) {
    const folder = join(dataDir, `recovered-${String(now)}`);
    mkdirSync(folder, { recursive: true });
    for (const name of unreferenced) renameSync(join(dataDir, name), join(folder, name));
    moved = { count: unreferenced.length, folder };
  }
  const damaged = join(dataDir, "damaged");
  if (existsSync(damaged)) for (const f of readdirSync(damaged)) rmSync(join(damaged, f), { recursive: true, force: true });

  renameSync(tmp, join(dataDir, "data.sqlite"));
  return { db: openDatabase(join(dataDir, "data.sqlite")), moved };
}

/** Moves the damaged database aside, keeping only the most recent damaged copy (FR-042a). */
function keepDamagedCopy(dataDir: string, now: number): string {
  const damaged = join(dataDir, "damaged");
  mkdirSync(damaged, { recursive: true });
  for (const f of readdirSync(damaged)) rmSync(join(damaged, f), { recursive: true, force: true });
  const target = join(damaged, `data-${String(now)}.sqlite`);
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = join(dataDir, `data.sqlite${suffix}`);
    if (existsSync(from)) renameSync(from, `${target}${suffix}`);
  }
  return target;
}

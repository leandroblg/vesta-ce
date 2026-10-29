/** Checks every minute whether a backup is due and writes it (FR-041, FR-041a, FR-041b). */
import type Database from "better-sqlite3";
import { BACKUP_INTERVAL_MS, isBackupDue } from "../../domain/backup-policy";
import type { Clock } from "../../domain/clock";
import type { Logger } from "../log";
import type { MaintenanceGate } from "../purge-scheduler";
import { readLatestJson, writeBackup } from "./backup";

export const BACKUP_CHECK_MS = 60_000;

interface Options {
  clock: Clock;
  dataDir: string;
  db: () => Database.Database;
  log: Logger;
  onFailed: (lastBackupAt: number | null) => void;
  onDamaged: () => void;
  /** 008 FR-050, FR-037c: no backup during an export, an import or an Undo import offer; a due one waits for idle. */
  gate?: MaintenanceGate;
}

export function startBackupScheduler({ clock, dataDir, db, log, onFailed, onDamaged, gate }: Options): () => void {
  let running = false;
  let stopped = false;
  /** After a failure, the next attempt waits a full interval instead of retrying every minute. */
  let notBefore = 0;
  const runTick = () => {
    void tick();
  };

  const tick = async () => {
    if (gate !== undefined && !gate.maintenanceAllowed()) {
      gate.whenIdle(runTick);
      return;
    }
    const now = clock.now();
    if (running || stopped || now < notBefore) return;
    const last = readLatestJson(dataDir)?.writtenAt ?? null;
    if (!isBackupDue(last, now)) return;
    running = true;
    const t0 = performance.now();
    try {
      const result = await writeBackup(db(), dataDir, now, log);
      log.debug("backup.run", { ms: Math.round(performance.now() - t0), outcome: result.kind });
      if (result.kind === "written") {
        log.info("backup.written", { at: result.at });
      } else if (result.kind === "failed") {
        log.error("backup.failed", { message: result.message });
        notBefore = now + BACKUP_INTERVAL_MS;
        onFailed(last);
      } else {
        log.error("backup.data-damaged", { message: "integrity check failed" });
        stopped = true; // no backup of a damaged database; the restore happens at the next start
        onDamaged();
      }
    } finally {
      running = false;
    }
  };

  void tick();
  const handle = setInterval(runTick, BACKUP_CHECK_MS);
  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

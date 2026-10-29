/**
 * The export and import channels (008 contracts/ipc.md, research §4, §6, §8). Main owns the dialogs, the files
 * and the gate; the renderer only ever gets outcomes, never a path.
 */
import { changedCleanups } from "../../domain/cleanup";
import { loadCleanupSettings, writeCleanupChangedAt } from "../db/settings-repo";
import { statfsSync } from "node:fs";
import type Database from "better-sqlite3";
import type { Clock } from "../../domain/clock";
import { localDate } from "../../domain/export/file-name";
import { EXPORTED_SETTING_KEYS, type ExportSetting } from "../../domain/export/format";
import { mergeImport, rewritePlanColors, type LocalData } from "../../domain/export/merge";
import type { DataSnapshot, ExportOutcome, ImportOutcome, ImportRefusal, UndoImportOutcome } from "../../shared/ipc-contract";
import { writeBackup } from "../backup/backup";
import { promotePreImport } from "../backup/promote";
import { restoreFromPreImport } from "../backup/restore-pre-import";
import { listAssetHashes } from "../db/assets-repo";
import { loadReminders } from "../db/reminders-repo";
import { loadAll } from "../db/tasks-repo";
import { loadAllEvents } from "../db/events-repo";
import { writeExport } from "../export/writer";
import { applyImport } from "../import/apply";
import { openExport, type OpenedExport } from "../import/reader";
import type { UndoImportOffer } from "../import/undo-offer";
import { errorMessage, type Logger } from "../log";
import type { OperationGate } from "../operation-gate";
import { DomainError } from "../../domain/task";
import { faultActive } from "../faults";
import { clampExportTimes, type Refusal } from "../../domain/export/parse";
import { importFits } from "../../domain/limits";
import { UndoExpiredError } from "./result";
import type { AsyncHandlers } from "./handlers";

export interface DataDeps {
  db: () => Database.Database;
  dataDir: string;
  clock: Clock;
  log: Logger;
  appVersion: string;
  isMac: boolean;
  gate: OperationGate;
  /** Saves the renderer's pending edits first, as on quit (FR-011, FR-030). */
  flushRenderer: () => Promise<void>;
  /** The OS folder or file picker, parented to the window; null when cancelled (FR-010, FR-020). */
  pickPath: (kind: "folder" | "file") => Promise<string | null>;
  /** 017 FR-015a: true while data saved by a newer version of Vesta is refused; export and import stop first. */
  dataRefused: () => boolean;
  /** Minutes west of UTC at `now`, for the local date in the file name. */
  timezoneOffset: (now: number) => number;
  /** InitialState minus startup, testHooks and isMac, read after an import or undo. */
  snapshot: () => DataSnapshot;
  offer: UndoImportOffer;
  /** Applies the stored theme, language and menu (after an import or undo, FR-040). */
  applySettings: () => void;
  /** The integrity check before the pre-import backup found the data corrupt (FR-036a, PRD A7). */
  onDataDamaged: () => void;
  /** Lets the background search fill index large details the import left pending (006). */
  kickSearch: () => void;
  /** 010 L10 (FR-014): the free bytes on the data folder's disk; injected for tests. */
  freeBytes?: (dir: string) => number;
}

function defaultFreeBytes(dir: string): number {
  const stats = statfsSync(dir);
  return stats.bavail * stats.bsize;
}

/** The local data the merge reads, in the same synchronous step as the write (analysis U1). */
function readLocal(db: Database.Database): LocalData {
  const placeholders = EXPORTED_SETTING_KEYS.map(() => "?").join(", ");
  const settings = (
    db.prepare(`select key, value, updated_at as updatedAt from settings where key in (${placeholders})`).all(...EXPORTED_SETTING_KEYS) as {
      key: ExportSetting["key"];
      value: string;
      updatedAt: number;
    }[]
  ).map((r) => ({ key: r.key, value: JSON.parse(r.value) as unknown, updatedAt: r.updatedAt }));
  return { tasks: loadAll(db), reminders: loadReminders(db), settings, assetHashes: new Set(listAssetHashes(db)), events: loadAllEvents(db) };
}

function toRefusal(r: Refusal): ImportRefusal {
  return r.kind === "newerVersion" ? { kind: "newerVersion" } : r;
}

export function buildDataHandlers(deps: DataDeps): AsyncHandlers {
  const { gate, offer, log } = deps;
  /** The offer's end: the pre-import backup becomes the latest, then the gate opens (FR-037a, FR-037c). */
  const offerEnded = () => {
    try {
      promotePreImport(deps.db(), deps.dataDir, log);
    } catch (err) {
      log.error("backup.promote-failed", { message: errorMessage(err) });
    }
    if (gate.state() === "undoOffered") gate.end();
  };

  return {
    "data:export": async ({ includeLogs }): Promise<ExportOutcome> => {
      if (deps.dataRefused()) return { kind: "dataRefused" };
      if (!deps.gate.tryBegin("export")) throw new DomainError("INVALID", "an export or import is already running");
      try {
        await deps.flushRenderer();
        const folder = await deps.pickPath("folder");
        if (folder === null) return { kind: "cancelled" };
        if (faultActive("slow-export")) await new Promise((r) => setTimeout(r, 1_500));
        const now = deps.clock.now();
        const t0 = performance.now();
        const result = await writeExport(
          { db: deps.db(), dataDir: deps.dataDir, appVersion: deps.appVersion, now, log: deps.log },
          folder,
          localDate(now, deps.timezoneOffset(now)),
          includeLogs,
        );
        log.debug("export.phase", { phase: result.kind, ms: Math.round(performance.now() - t0) });
        return result;
      } finally {
        deps.gate.end();
      }
    },

    "data:import": async (): Promise<ImportOutcome> => {
      if (deps.dataRefused()) return { kind: "dataRefused" };
      if (!gate.tryBegin("import")) throw new DomainError("INVALID", "an export or import is already running");
      let opened: OpenedExport | null = null;
      try {
        await deps.flushRenderer();
        const path = await deps.pickPath("file");
        if (path === null) return { kind: "cancelled" };
        if (faultActive("slow-import")) await new Promise((r) => setTimeout(r, 1_500));
        const t0 = performance.now();
        const read = await openExport(path, { log });
        log.debug("import.phase", { phase: "read", ms: Math.round(performance.now() - t0) });
        if (!read.ok) return { kind: "refused", refusal: toRefusal(read.refusal) };
        opened = read.opened;
        // 010 L14 (FR-012): times later than the import moment become the import moment, before the merge.
        const clamped = clampExportTimes(opened.data, deps.clock.now());
        if (clamped.count > 0) log.info("import.clamped-times", { count: clamped.count });
        opened.data = clamped.data;
        // 010 L10 (FR-014): enough room for the files and the database, or the import does not start.
        const listedBytes = opened.data.assets.reduce((sum, a) => sum + a.size, 0);
        const free = (deps.freeBytes ?? defaultFreeBytes)(deps.dataDir);
        if (!importFits(listedBytes, free)) {
          log.warn("import.refused", { kind: "noSpace", listedBytes, free });
          return { kind: "refused", refusal: { kind: "noSpace" } };
        }
        const db = deps.db();

        // FR-036a: a verified backup of the current data before anything is written.
        const backup = await writeBackup(db, deps.dataDir, deps.clock.now(), log, "pre-import");
        if (backup.kind !== "written") {
          log.error("import.not-started", { message: backup.kind === "failed" ? backup.message : "integrity check failed" });
          if (backup.kind === "damaged") deps.onDataDamaged();
          return { kind: "notStarted" };
        }

        try {
          const firstBytes = await opened.copyFiles(deps.dataDir, opened.data.assets);
          // Read, merge and write with no await in between (analysis U1).
          const now = deps.clock.now();
          // 011 FR-015: imported colors are written in 8 digits, like stored ones.
          const plan = rewritePlanColors(mergeImport(readLocal(db), opened.data, { now, isMac: deps.isMac }));
          applyImport(db, plan, now, firstBytes);
          for (const repair of plan.repairs) log.info("import.repaired", { ...repair });
          if (plan.droppedShortcuts.length > 0) log.warn("import.shortcuts-dropped", { actions: plan.droppedShortcuts });
          log.info("import.merged", { ...plan.counts, files: plan.assetsToAdd.length });
          log.debug("import.phase", { phase: "merged", ms: Math.round(performance.now() - t0) });
          deps.applySettings();
          deps.kickSearch();
          const undo = offer.start(offerEnded);
          gate.offerUndo(() => {
            offer.end();
          });
          return { kind: "merged", counts: plan.counts, undo: { ...undo, now: deps.clock.now() }, data: deps.snapshot() };
        } catch (err) {
          // FR-037: the transaction rolled back; the pre-import backup is restored all the same.
          log.error("import.failed", { message: errorMessage(err) });
          try {
            restoreFromPreImport(db, deps.dataDir);
          } catch (restoreErr) {
            log.error("import.restore-failed", { message: errorMessage(restoreErr) });
          }
          offerEnded();
          deps.applySettings();
          return { kind: "failedRestored", data: deps.snapshot() };
        }
      } finally {
        opened?.close();
        if (gate.state() === "importing") gate.end();
      }
    },

    "data:undo-import": ({ token }): Promise<UndoImportOutcome> => {
      if (!offer.isValid(token)) throw new UndoExpiredError();
      // 018 FR-016a (research §7): putting a cleanup setting back is itself a change; its hour restarts from now.
      const cleanupBefore = loadCleanupSettings(deps.db()).settings;
      try {
        restoreFromPreImport(deps.db(), deps.dataDir);
        for (const which of changedCleanups(cleanupBefore, loadCleanupSettings(deps.db()).settings)) writeCleanupChangedAt(deps.db(), which, deps.clock.now());
      } catch (err) {
        // One transaction: the merged data is intact (FR-037b).
        log.error("import.undo-failed", { message: errorMessage(err) });
        return Promise.resolve({ kind: "undoFailed" });
      }
      log.info("import.undone");
      offer.end();
      deps.applySettings();
      deps.kickSearch();
      return Promise.resolve({ kind: "undone", data: deps.snapshot() });
    },

    "data:end-undo-offer": () => {
      offer.end();
      return Promise.resolve(null);
    },
  };
}

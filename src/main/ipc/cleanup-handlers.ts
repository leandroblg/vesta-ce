/**
 * 018 contracts/ipc-cleanup.md (FR-020a to FR-020d; PRD Q277, Q278, Q282, Q287): a cleanup change, with the native
 * confirmation main asks when the change would remove items or turns the Trash cleanup off, and the time left of each
 * cleanup's hour after a change, for the countdown.
 */
import type Database from "better-sqlite3";
import type { Clock } from "../../domain/clock";
import { HOUR_MS, needsConfirm, wouldRemove, type CleanupWhich } from "../../domain/cleanup";
import type { CleanupView } from "../../shared/ipc-contract";
import { loadReminders } from "../db/reminders-repo";
import { loadCleanupSettings, saveCleanupSetting } from "../db/settings-repo";
import { loadAll } from "../db/tasks-repo";
import type { AsyncHandlers } from "./handlers";

/** What the native box names: the cleanup and the count its next check would remove, or the Trash turned off. */
export type CleanupConfirm = (request: { kind: "cleanupArchive" | "cleanupTrash" | "trashOff"; count: number }) => Promise<boolean>;

export interface CleanupDeps {
  db: () => Database.Database;
  clock: Clock;
  log: { info(event: string, data?: Record<string, unknown>): void };
  confirm: CleanupConfirm;
}

const remaining = (changedAt: number | undefined, now: number): number | null =>
  changedAt === undefined || now - changedAt >= HOUR_MS ? null : HOUR_MS - (now - changedAt);

/** Each cleanup as Settings shows it, for the initial state and a data snapshot. */
export function cleanupViews(db: Database.Database, now: number): Record<CleanupWhich, CleanupView> {
  const { settings, changedAt } = loadCleanupSettings(db);
  return {
    archive: { ...settings.archive, remainingMs: remaining(changedAt.archive, now) },
    trash: { ...settings.trash, remainingMs: remaining(changedAt.trash, now) },
  };
}

export function buildCleanupHandlers(deps: CleanupDeps): AsyncHandlers {
  return {
    "settings:set-cleanup": async ({ which, on, hours, commit }) => {
      const db = deps.db();
      const now = deps.clock.now();
      const saved = loadCleanupSettings(db).settings[which];
      const unchanged = { saved: false, pending: false, ...cleanupViews(db, now)[which] };
      if (saved.on === on && saved.hours === hours) return unchanged;
      const next = { on, hours };
      const count = on ? wouldRemove(loadAll(db), loadReminders(db), now, which, hours) : 0;
      const asks = needsConfirm(which, saved, next, count);
      if (asks) {
        // Before a commit (blur or Enter), a change that needs a dialog waits; the fields hold it (Q282, Q287).
        if (!commit) return { ...unchanged, pending: true };
        const kind = which === "trash" && saved.on && !on ? "trashOff" : which === "archive" ? "cleanupArchive" : "cleanupTrash";
        if (!(await deps.confirm({ kind, count }))) return unchanged;
      }
      saveCleanupSetting(db, which, on, hours, deps.clock.now());
      deps.log.info("settings.cleanup", { which, on, hours, confirmed: asks });
      return { saved: true, pending: false, on, hours, remainingMs: HOUR_MS };
    },
    "cleanup:status": () => {
      const views = cleanupViews(deps.db(), deps.clock.now());
      return Promise.resolve({ archive: { remainingMs: views.archive.remainingMs }, trash: { remainingMs: views.trash.remainingMs } });
    },
  };
}

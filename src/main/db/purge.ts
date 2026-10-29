/**
 * The hourly purge over both tables in one transaction (001 FR-035, 002 FR-019; research.md §7), with 018's two
 * independent cleanups (FR-017, FR-018, Q278): the Archive by completion date and the Trash by deletion date.
 */
import type Database from "better-sqlite3";
import {
  DEFAULT_CLEANUP,
  cleanupActive,
  selectArchiveExpired,
  selectArchiveExpiredReminders,
  selectTrashExpired,
  selectTrashExpiredReminders,
} from "../../domain/cleanup";
import { faultActive } from "../faults";
import { purgeAssets } from "../assets/locks";
import type { Logger } from "../log";
import { applyReminderChangeSet, loadReminders } from "./reminders-repo";
import { applyChangeSet, loadAll } from "./tasks-repo";
import { maintainAfterPurge } from "./connection";
import { loadCleanupSettings } from "./settings-repo";

/** Each cleanup's time in hours, or null while it is off or waits out the hour after a change (FR-020b). */
export interface PurgeRules {
  archive: { hours: number } | null;
  trash: { hours: number } | null;
}

/** 018 FR-017, FR-020b: the rules of a run at `now`, read from the saved settings and change times, so a change made
 * before a restart still holds its cleanup back for the rest of its hour. */
export function purgeRulesAt(db: Database.Database, now: number): PurgeRules {
  const { settings, changedAt } = loadCleanupSettings(db);
  return {
    archive: cleanupActive(settings.archive, changedAt.archive, now) ? { hours: settings.archive.hours } : null,
    trash: cleanupActive(settings.trash, changedAt.trash, now) ? { hours: settings.trash.hours } : null,
  };
}

/** The Trash's own rule before 018: 30 days, no Archive cleanup (callers that pass no rules). */
const TRASH_ONLY: PurgeRules = { archive: null, trash: { hours: DEFAULT_CLEANUP.trash.hours } };

export interface PurgeResult {
  removals: string[];
  reminderRemovals: string[];
  /** Rows removed by each cleanup, tasks and reminders together. */
  archive: number;
  trash: number;
}

/** Removes every expired task and reminder, or nothing (throws). Returns the removed ids and the counts by rule. */
export function purgeExpired(
  db: Database.Database,
  now: number,
  files?: { dir: string; log: Pick<Logger, "warn" | "error" | "info"> },
  rules: PurgeRules = TRASH_ONLY,
): PurgeResult {
  const tasks = loadAll(db);
  const reminders = loadReminders(db);
  const archiveTasks = rules.archive === null ? [] : selectArchiveExpired(tasks, now, rules.archive.hours);
  const archiveReminders = rules.archive === null ? [] : selectArchiveExpiredReminders(reminders, now, rules.archive.hours);
  const trashTasks = rules.trash === null ? [] : selectTrashExpired(tasks, now, rules.trash.hours);
  const trashReminders = rules.trash === null ? [] : selectTrashExpiredReminders(reminders, now, rules.trash.hours);
  const removals = [...trashTasks, ...archiveTasks];
  const reminderRemovals = [...trashReminders, ...archiveReminders];
  if (faultActive("purge")) throw new Error("VESTA_FAULT=purge");
  db.transaction(() => {
    applyChangeSet(db, { upserts: [], removals });
    applyReminderChangeSet(db, { upserts: [], removals: reminderRemovals, sectionCollapsed: null }, now);
  })();
  // 005 FR-032: stored files no item references any more (backup locks kept, FR-032a).
  if (files !== undefined) purgeAssets(db, files.dir, now, files.log);
  // 010 FR-024 (L15): after every run, whether or not rows went, so a permanent deletion by hand is covered too.
  maintainAfterPurge(db);
  return {
    removals,
    reminderRemovals,
    archive: archiveTasks.length + archiveReminders.length,
    trash: trashTasks.length + trashReminders.length,
  };
}

/**
 * 018 automatic cleanups (FR-014 to FR-020d, FR-016a, FR-017a; PRD Q273, Q277–Q283, Q287; research §5, data-model.md
 * "Cleanup rules"): the Archive cleanup removes items done longer than its time, the Trash cleanup items deleted longer
 * than its time, each independently, with the rows that went with them. Times are whole hours: a year is 365 days and a
 * day 24 hours, with no calendar arithmetic (FR-020).
 */
import type { Reminder } from "./reminder";
import type { Task } from "./task";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
const YEAR_HOURS = 365 * 24;

/** The Undo notification's 10 s and a margin: the Archive cleanup leaves a group changed this recently (Q283). */
export const UNDO_WINDOW_MS = 11_000;

export type CleanupField = "years" | "days" | "hours";
export interface CleanupParts {
  years: number;
  days: number;
  hours: number;
}

export const CLEANUP_LIMITS = {
  years: { min: 0, max: 1000 },
  days: { min: 0, max: 364 },
  hours: { min: 0, max: 23 },
  minTotalHours: 1,
  maxTotalHours: 1000 * YEAR_HOURS + 364 * 24 + 23,
} as const;

export type CleanupWhich = "archive" | "trash";
export interface CleanupSetting {
  on: boolean;
  hours: number;
}
export type CleanupSettings = Record<CleanupWhich, CleanupSetting>;

/** On by default: the Archive after 10 years, the Trash after 30 days (Q273, Q278). */
export const DEFAULT_CLEANUP: CleanupSettings = {
  archive: { on: true, hours: 10 * YEAR_HOURS },
  trash: { on: true, hours: 30 * 24 },
};

export function splitHours(total: number): CleanupParts {
  const years = Math.floor(total / YEAR_HOURS);
  const rest = total - years * YEAR_HOURS;
  return { years, days: Math.floor(rest / 24), hours: rest % 24 };
}

export function joinHours(p: CleanupParts): number {
  return p.years * YEAR_HOURS + p.days * 24 + p.hours;
}

/** Q237: a typed value above a field's maximum becomes that maximum at once; below zero, zero. */
export function clampCleanupField(field: CleanupField, value: number): number {
  const { min, max } = CLEANUP_LIMITS[field];
  return Math.min(max, Math.max(min, value));
}

/** The total in hours, or `"min"` for a zero total, which is refused (FR-015). */
export function validCleanup(p: CleanupParts): number | "min" {
  const total = joinHours(p);
  return total < CLEANUP_LIMITS.minTotalHours ? "min" : total;
}

/** On, and no change is pending or the hour after the last saved change has passed (FR-020b). */
export function cleanupActive(setting: CleanupSetting, changedAt: number | undefined, now: number): boolean {
  return setting.on && (changedAt === undefined || now - changedAt >= HOUR_MS);
}

/**
 * Archive tasks done `hours` or more ago: top entries with the subtasks that went with them, and done subtasks listed on
 * their own by their own date. A group with a row changed during the Undo window waits for a later check (Q283).
 */
export function selectArchiveExpired(tasks: readonly Task[], now: number, hours: number): string[] {
  const inArchive = (t: Task) => t.doneAt !== null && t.deletedAt === null;
  const recent = (t: Task) => now - t.updatedAt < UNDO_WINDOW_MS;
  const out: string[] = [];
  for (const top of tasks) {
    if (!inArchive(top) || top.leftWithId !== null || now - (top.doneAt ?? now) < hours * HOUR_MS) continue;
    const along = tasks.filter((t) => t.leftWithId === top.id && inArchive(t));
    if (recent(top) || along.some(recent)) continue;
    out.push(top.id, ...along.map((t) => t.id));
  }
  return out;
}

export function selectArchiveExpiredReminders(rows: readonly Reminder[], now: number, hours: number): string[] {
  return rows
    .filter((r) => r.doneAt !== null && r.deletedAt === null && now - r.doneAt >= hours * HOUR_MS && now - r.updatedAt >= UNDO_WINDOW_MS)
    .map((r) => r.id);
}

/** Trash tasks deleted `hours` or more ago, timed by the deletion date only, with the rows that went with them. */
export function selectTrashExpired(tasks: readonly Task[], now: number, hours: number): string[] {
  const expired = new Set(
    tasks.filter((t) => t.deletedAt !== null && t.leftWithId === null && now - t.deletedAt >= hours * HOUR_MS).map((t) => t.id),
  );
  const along = tasks.filter((t) => t.deletedAt !== null && t.leftWithId !== null && expired.has(t.leftWithId)).map((t) => t.id);
  return [...expired, ...along];
}

export function selectTrashExpiredReminders(rows: readonly Reminder[], now: number, hours: number): string[] {
  return rows.filter((r) => r.deletedAt !== null && now - r.deletedAt >= hours * HOUR_MS).map((r) => r.id);
}

/** The time left before a Trash item is removed, in ms; null while the Trash cleanup is off (FR-019). */
export function timeLeft(deletedAt: number, now: number, trash: CleanupSetting): number | null {
  if (!trash.on) return null;
  return Math.max(0, trash.hours * HOUR_MS - Math.max(0, now - deletedAt));
}

/** How many items, tasks, subtasks and reminders, that cleanup's next check would remove under `hours` (FR-020a). */
export function wouldRemove(tasks: readonly Task[], reminders: readonly Reminder[], now: number, which: CleanupWhich, hours: number): number {
  return which === "archive"
    ? selectArchiveExpired(tasks, now, hours).length + selectArchiveExpiredReminders(reminders, now, hours).length
    : selectTrashExpired(tasks, now, hours).length + selectTrashExpiredReminders(reminders, now, hours).length;
}

/**
 * Whether a change asks first (FR-020a, FR-020c; Q282, Q287): a shorter time or a cleanup turned on when the next check
 * would remove at least one item, and the Trash cleanup turned off always. A longer time, a shorter time that removes
 * nothing and the Archive cleanup turned off save at once.
 */
export function needsConfirm(which: CleanupWhich, saved: CleanupSetting, next: CleanupSetting, count: number): boolean {
  if (which === "trash" && saved.on && !next.on) return true;
  if (!next.on) return false;
  const narrows = !saved.on || next.hours < saved.hours;
  return narrows && count > 0;
}

export type CleanupSettingKey = "archiveCleanupOn" | "archiveCleanupHours" | "trashCleanupOn" | "trashCleanupHours";
export const CLEANUP_SETTING_KEYS: readonly CleanupSettingKey[] = ["archiveCleanupOn", "archiveCleanupHours", "trashCleanupOn", "trashCleanupHours"];

/** Q280: an imported cleanup setting is taken only when it keeps more: a switch turned off, or a longer time. */
export function keepsMore(key: CleanupSettingKey, local: boolean | number, imported: boolean | number): boolean {
  if (key.endsWith("On")) return local === true && imported === false;
  return typeof local === "number" && typeof imported === "number" && imported > local;
}

/** The cleanups whose switch or time differ between two readings (an Undo import that put one back, research §7). */
export function changedCleanups(a: CleanupSettings, b: CleanupSettings): CleanupWhich[] {
  return (["archive", "trash"] as const).filter((w) => a[w].on !== b[w].on || a[w].hours !== b[w].hours);
}

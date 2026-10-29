/**
 * The one place every size, length and range limit lives (010 research §1, audit L1, L10, L14).
 * IPC validation (src/shared/validate.ts) and the import parser (src/domain/export/parse.ts) both read
 * these constants, so the two entry points cannot drift. Pure TypeScript: no Electron, no DOM.
 */

/** Titles and reminder texts (L1). */
export const MAX_TITLE_CHARS = 10_000;
export const MAX_REMINDER_CHARS = 10_000;
/** Details (005 contracts/ipc.md). */
export const MAX_DETAILS_CHARS = 1_000_000;
/** The three fields of app:log-error (L1). */
export const MAX_LOG_MESSAGE_CHARS = 4_096;
export const MAX_LOG_STACK_CHARS = 65_536;
export const MAX_LOG_CONTEXT_CHARS = 200;
/** Undo and Undo import tokens (L1). */
export const MAX_TOKEN_CHARS = 64;
/** Existing 005 to 009 limits, gathered here. */
export const MAX_FILE_NAME_CHARS = 255;
export const MAX_SEARCH_CHARS = 10_000;
export const MAX_PATH_CHARS = 4_096;
export const MAX_URL_CHARS = 2_048;
/** An alert override in minutes: 1 h to 9999 d 23 h 59 min (003 FR-035). */
export const OVERRIDE_MIN_MINUTES = 60;
export const OVERRIDE_MAX_MINUTES = 14_399_999;

/** Import limits (L10): data.json 64 MiB, 10,000 listed files, 4 GiB in total. */
export const MAX_DATA_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_IMPORT_FILES = 10_000;
export const MAX_IMPORT_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
/** The room the database may need beyond the copied files (FR-014 free-space check). */
export const IMPORT_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;

/** True when the data folder's disk can take the listed files plus the margin (FR-014, L10). */
export function importFits(listedBytes: number, freeBytes: number): boolean {
  return freeBytes >= listedBytes + IMPORT_SPACE_MARGIN_BYTES;
}

/** The update reminder period in days (PRD Q133). */
export const REMINDER_DAYS_MIN = 7;
export const REMINDER_DAYS_MAX = 365;
export const REMINDER_DAYS_DEFAULT = 30;

/** Pinned and recent colors of the color picker (011 FR-011, FR-012). */
export const MAX_PINNED_COLORS = 10;
export const MAX_RECENT_COLORS = 20;
/** Table sizes: the typed fields go up to 100 × 100; the size grid shows 8 × 8 to 20 × 20 (011 FR-019, FR-020a). */
export const MAX_TABLE_SIZE = 100;
export const GRID_MIN = 8;
export const GRID_MAX = 20;
/** A press held this long on Table opens the size grid (011 FR-019). */
export const LONG_PRESS_MS = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vesta's id shape, required of every id on IPC and in an import (L14). */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** The time fields an import clamps (L14, contracts/import-rules.md "Times"). */
export const TASK_TIME_FIELDS = [
  "createdAt",
  "updatedAt",
  "doneAt",
  "deletedAt",
  "staleBaseAt",
  "staleSince",
  "lastBlinkAt",
  "lastSignalAt",
  "keptDoneAt",
] as const;
export const REMINDER_TIME_FIELDS = ["createdAt", "updatedAt", "doneAt", "deletedAt", "keptDoneAt"] as const;

/**
 * Copies `rows`, setting every listed field that is a number later than `now` to `now`; nulls and earlier
 * values are untouched. `count` is the number of values changed (L14: a far-future time can no longer pin a
 * row against later imports).
 */
export function clampTimes<T extends object>(
  rows: readonly T[],
  fields: readonly (keyof T & string)[],
  now: number,
): { rows: T[]; count: number } {
  let count = 0;
  const out = rows.map((row) => {
    let copy: T | null = null;
    for (const field of fields) {
      const value = row[field];
      if (typeof value === "number" && value > now) {
        copy ??= { ...row };
        (copy as Record<string, unknown>)[field] = now;
        count += 1;
      }
    }
    return copy ?? row;
  });
  return { rows: out, count };
}

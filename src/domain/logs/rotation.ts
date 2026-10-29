/**
 * Log rotation (009 FR-005 to FR-007, research §2). Files `vesta-NNN.log` of at most 1 MiB, 50 MiB in all.
 * Numbers run 001–999 and then 001 again; with at most 50 files the numbers in use form one circular run,
 * so the oldest file is the one just after the largest gap. Modification times are never used.
 */

export const LOG_FILE_MAX = 1_048_576;
export const LOG_TOTAL_MAX = 52_428_800;
export const LOG_MAX_FILES = 50;
const MAX_NUMBER = 999;
const NAME = /^vesta-(\d{3})\.log$/;

export interface LogFileInfo {
  name: string;
  number: number;
  size: number;
}

export interface WritePlan {
  /** Where the line goes. */
  file: string;
  /** Create this file first. */
  startNew: boolean;
  /** Oldest first, deleted before the new file is created. */
  delete: string[];
}

export const fileName = (n: number): string => `vesta-${String(n).padStart(3, "0")}.log`;

/** The file's number, or null for a name that is not Vesta's (never read, shown or deleted). */
export function parseFileName(name: string): number | null {
  const m = NAME.exec(name);
  if (m === null) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_NUMBER ? n : null;
}

/** File numbers, oldest to newest. */
export function orderFiles(numbers: readonly number[]): number[] {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted;
  // The gap from the last number round to the first; the plain order wins when it is the largest.
  let start = 0;
  let largest = (sorted[0] ?? 0) + MAX_NUMBER - (sorted[sorted.length - 1] ?? 0);
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i] ?? 0) - (sorted[i - 1] ?? 0);
    if (gap > largest) {
      largest = gap;
      start = i;
    }
  }
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

/** Where a line of `bytes` goes, and which files go first so the limits hold after it is written. */
export function planWrite(files: readonly LogFileInfo[], bytes: number): WritePlan {
  const byNumber = new Map(files.map((f) => [f.number, f]));
  const ordered = orderFiles(files.map((f) => f.number)).flatMap((n) => byNumber.get(n) ?? []);
  const newest = ordered[ordered.length - 1];
  if (newest === undefined) return { file: fileName(1), startNew: true, delete: [] };
  if (newest.size + bytes <= LOG_FILE_MAX) return { file: newest.name, startNew: false, delete: [] };

  const next = (newest.number % MAX_NUMBER) + 1;
  const remove: string[] = [];
  let total = ordered.reduce((sum, f) => sum + f.size, 0);
  let count = ordered.length;
  for (const f of ordered) {
    if (total + LOG_FILE_MAX <= LOG_TOTAL_MAX && count + 1 <= LOG_MAX_FILES) break;
    remove.push(f.name);
    total -= f.size;
    count -= 1;
  }
  return { file: fileName(next), startNew: true, delete: remove };
}

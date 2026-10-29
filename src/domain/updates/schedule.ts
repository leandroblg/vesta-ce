/**
 * When the update check runs (009 FR-021, FR-021a, FR-022b; PRD Q124). Pure, on the injectable clock: at start,
 * 24 h after a success, 1 h after a failure (hourly until a success), never while automatic checks are off,
 * and never within a minute of the previous request, whatever triggered it.
 */

export const DAY_MS = 24 * 60 * 60_000;
export const HOUR_MS = 60 * 60_000;
export const SPACING_MS = 60_000;

export interface UpdateSchedule {
  auto: boolean;
  lastAttemptAt: number | null;
  lastFailed: boolean;
  running: boolean;
  /** Ticking "Check for updates automatically" asks for a check at once (FR-021a). */
  dueNow: boolean;
}

export const initialSchedule = (auto: boolean): UpdateSchedule => ({ auto, lastAttemptAt: null, lastFailed: false, running: false, dueNow: false });

export function afterAttempt(s: UpdateSchedule, at: number, ok: boolean): UpdateSchedule {
  return { ...s, lastAttemptAt: at, lastFailed: !ok, running: false, dueNow: false };
}

/** The time the next automatic check is due; null when automatic checks are off. */
export function nextDue(s: UpdateSchedule): number | null {
  if (!s.auto) return null;
  if (s.lastAttemptAt === null || s.dueNow) return Number.NEGATIVE_INFINITY;
  return s.lastAttemptAt + (s.lastFailed ? HOUR_MS : DAY_MS);
}

/** No request while one runs or within a minute of the last; a clock that went backwards allows one. */
export function mayRequest(s: UpdateSchedule, now: number): boolean {
  if (s.running) return false;
  if (s.lastAttemptAt === null) return true;
  const elapsed = now - s.lastAttemptAt;
  return elapsed < 0 || elapsed >= SPACING_MS;
}

export function isDue(s: UpdateSchedule, now: number): boolean {
  const due = nextDue(s);
  if (due === null || !mayRequest(s, now)) return false;
  return now >= due || (s.lastAttemptAt !== null && now < s.lastAttemptAt);
}

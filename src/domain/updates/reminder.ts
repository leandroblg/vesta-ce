/** The update reminder while automatic checks are off (PRD Q133; 010 FR-033 to FR-035, research §10). Pure. */
export const DAY_MS = 86_400_000;

export interface ReminderInput {
  /** "Check for updates automatically" (009). No reminder is ever due while it is on. */
  auto: boolean;
  /** "Remind me to check for updates" (default true). */
  on: boolean;
  /** The period in days, 7 to 365 (default 30). */
  days: number;
  /** The latest of: automatic checks turned off, the last completed check, the last reminder sent. */
  anchor: number | null;
}

/** True when a reminder is due now. */
export function reminderDue(input: ReminderInput, now: number): boolean {
  if (input.auto || !input.on || input.anchor === null) return false;
  return now - input.anchor >= input.days * DAY_MS;
}

/** A future anchor left by the clock moving backwards counts as now (003 Q99), so the reminder is neither lost nor repeated. */
export function anchorAfterClockBack(anchor: number, now: number): number {
  return anchor > now ? now : anchor;
}

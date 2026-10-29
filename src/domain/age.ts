/** Age labels in two units and durations, with the unit letters given by the locale (003 FR-012, FR-013). */

export interface AgeUnits {
  d: string;
  h: string;
  m: string;
}

const MINUTE = 60_000;

/** `12d 3h`, `5h 40m`, `40m`; rounded down, never negative. */
export function formatAge(ms: number, units: AgeUnits): string {
  const total = Math.floor(Math.max(0, ms) / MINUTE);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return `${String(days)}${units.d} ${String(hours)}${units.h}`;
  if (hours > 0) return `${String(hours)}${units.h} ${String(minutes)}${units.m}`;
  return `${String(minutes)}${units.m}`;
}

/** A duration in minutes with its non-zero parts: `1d`, `1d 2h 5m`; `0m` for zero. */
export function formatDuration(totalMinutes: number, units: AgeUnits): string {
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}${units.d}`);
  if (hours > 0) parts.push(`${String(hours)}${units.h}`);
  if (minutes > 0) parts.push(`${String(minutes)}${units.m}`);
  return parts.length === 0 ? `0${units.m}` : parts.join(" ");
}

/**
 * One end of an allowed range: minutes below an hour, a whole number of days in days, whole hours in hours, else
 * days, hours and minutes (016 FR-034, PRD Q238: "30 days", never "720 hours").
 */
function rangeEnd(minutes: number, units: AgeUnits): string {
  if (minutes < 60) return `${String(minutes)}${units.m}`;
  if (minutes % 1440 === 0) return `${String(minutes / 1440)}${units.d}`;
  if (minutes % 60 === 0 && minutes < 1440) return `${String(minutes / 60)}${units.h}`;
  return formatDuration(minutes, units);
}

/** The `{r}` of "Allowed range: {r}." in the language's unit letters (007 FR-007): "30m – 30d". */
export function formatRange(minMinutes: number, maxMinutes: number, units: AgeUnits): string {
  return `${rangeEnd(minMinutes, units)} – ${rangeEnd(maxMinutes, units)}`;
}

/**
 * Log levels (009 FR-002, FR-010, FR-017; PRD Q123). Fatal, Error, Warn and Info are always recorded; Debug
 * and Trace only while selected. The viewer shows the selected level and every more important one.
 */

export const LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export type LogLevel = (typeof LEVELS)[number];

/** The least important level written to the files (research §5). */
export type RecordFloor = "info" | "debug" | "trace";

const rank = (level: LogLevel): number => LEVELS.indexOf(level);

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

export function recordFloor(selected: LogLevel): RecordFloor {
  return selected === "debug" || selected === "trace" ? selected : "info";
}

export function records(level: LogLevel, floor: RecordFloor): boolean {
  return rank(level) <= rank(floor);
}

export function shows(level: LogLevel, selected: LogLevel): boolean {
  return rank(level) <= rank(selected);
}

/** The global alert settings, their limits, and the override fields (PRD A4; 003 FR-001, FR-035; 015 Q207). */

export interface AlertSettings {
  alertPeriodMin: number;
  reblinkIntervalMin: number;
  rescheduleToleranceMin: number;
  /** The four quick reschedule durations, in order (015 Q207); `quickDurations` returns them as a tuple. */
  quickReschedule1Min: number;
  quickReschedule2Min: number;
  quickReschedule3Min: number;
  quickReschedule4Min: number;
}

export type AlertSettingKey = keyof AlertSettings;

export const DEFAULT_ALERT_SETTINGS: Readonly<AlertSettings> = Object.freeze({
  alertPeriodMin: 1440,
  reblinkIntervalMin: 240,
  rescheduleToleranceMin: 1440,
  quickReschedule1Min: 60,
  quickReschedule2Min: 120,
  quickReschedule3Min: 240,
  quickReschedule4Min: 360,
});

/** 9999 d 23 h 59 min, the largest value the days/hours/minutes fields can express. */
const MAX_PERIOD = 9999 * 1440 + 23 * 60 + 59;

export const ALERT_LIMITS: Readonly<Record<AlertSettingKey, { min: number; max: number }>> = Object.freeze({
  alertPeriodMin: { min: 60, max: MAX_PERIOD },
  reblinkIntervalMin: { min: 30, max: 720 * 60 },
  rescheduleToleranceMin: { min: 60, max: 720 * 60 },
  quickReschedule1Min: { min: 60, max: 720 * 60 },
  quickReschedule2Min: { min: 60, max: 720 * 60 },
  quickReschedule3Min: { min: 60, max: 720 * 60 },
  quickReschedule4Min: { min: 60, max: 720 * 60 },
});

export const ALERT_SETTING_KEYS: readonly AlertSettingKey[] = [
  "alertPeriodMin",
  "reblinkIntervalMin",
  "rescheduleToleranceMin",
  "quickReschedule1Min",
  "quickReschedule2Min",
  "quickReschedule3Min",
  "quickReschedule4Min",
];

/** The quick reschedule duration keys, in menu order (015 Q207). */
export const QUICK_RESCHEDULE_KEYS = ["quickReschedule1Min", "quickReschedule2Min", "quickReschedule3Min", "quickReschedule4Min"] as const;

/** The four quick reschedule durations in minutes, in menu order (015 Q207). */
export function quickDurations(settings: Readonly<AlertSettings>): readonly [number, number, number, number] {
  return [settings.quickReschedule1Min, settings.quickReschedule2Min, settings.quickReschedule3Min, settings.quickReschedule4Min];
}

export interface SettingIssue {
  key: AlertSettingKey;
  kind: "missing" | "unreadable" | "clamped";
}

/** Stored values (JSON integers as text) → usable settings; every value that was not used as stored is reported. */
export function normalizeAlertSettings(raw: Readonly<Record<string, string | undefined>>): { settings: AlertSettings; issues: SettingIssue[] } {
  const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS };
  const issues: SettingIssue[] = [];
  for (const key of ALERT_SETTING_KEYS) {
    const text = raw[key];
    if (text === undefined) {
      issues.push({ key, kind: "missing" });
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      issues.push({ key, kind: "unreadable" });
      continue;
    }
    const { min, max } = ALERT_LIMITS[key];
    const clamped = Math.min(max, Math.max(min, value));
    if (clamped !== value) issues.push({ key, kind: "clamped" });
    settings[key] = clamped;
  }
  return { settings, issues };
}

/** The largest days field per setting: 9999 for the alert period, 30 (720 h) for the others (007 FR-006). */
const MAX_DAYS: Readonly<Record<AlertSettingKey, number>> = {
  alertPeriodMin: 9999,
  reblinkIntervalMin: 30,
  rescheduleToleranceMin: 30,
  quickReschedule1Min: 30,
  quickReschedule2Min: 30,
  quickReschedule3Min: 30,
  quickReschedule4Min: 30,
};

/**
 * Total minutes for valid days/hours/minutes fields of a setting, `"min"` below its minimum, or `"range"` for a
 * field outside its range or a total above the maximum (007 FR-006, FR-007).
 */
export function validDuration(key: AlertSettingKey, days: number, hours: number, minutes: number): number | "min" | "range" {
  const inRange = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!inRange(days, MAX_DAYS[key]) || !inRange(hours, 23) || !inRange(minutes, 59)) return "range";
  const total = days * 1440 + hours * 60 + minutes;
  const { min, max } = ALERT_LIMITS[key];
  if (total < min) return "min";
  return total > max ? "range" : total;
}

export type DurationField = "days" | "hours" | "minutes";

/** 016 FR-031: a field's largest value: 59 minutes, 23 hours, 30 days, or 9999 days for the alert period. */
export function fieldMax(key: AlertSettingKey, field: DurationField): number {
  return field === "days" ? MAX_DAYS[key] : field === "hours" ? 23 : 59;
}

/**
 * 016 FR-031, FR-032 (PRD Q237): the fields after typing `raw` into `field`. A value above the field's maximum becomes
 * the maximum at once; on a 30-day setting, days 30 zero the hours and minutes, and hours or minutes typed while days
 * is 30 become 0. An empty or non-numeric entry, or one below the minimum, is left for the usual validation.
 */
export function clampField(
  key: AlertSettingKey,
  field: DurationField,
  raw: string,
  current: Readonly<Record<DurationField, string>>,
): Record<DurationField, string> {
  const next = { ...current, [field]: raw };
  if (!/^\d+$/.test(raw.trim())) return next;
  const max = fieldMax(key, field);
  if (Number(raw) > max) next[field] = String(max);
  if (MAX_DAYS[key] === 30) {
    const daysAtMax = /^\d+$/.test(next.days.trim()) && Number(next.days) >= 30;
    if (daysAtMax) {
      if (field === "days") {
        next.hours = "0";
        next.minutes = "0";
      } else {
        next[field] = "0";
      }
    }
  }
  return next;
}

/** Total minutes for valid override fields, or why they are refused (FR-037). */
export function validOverride(days: number, hours: number, minutes: number): number | "min1h" | "range" {
  const result = validDuration("alertPeriodMin", days, hours, minutes);
  return result === "min" ? "min1h" : result;
}

export function splitMinutes(total: number): { days: number; hours: number; minutes: number } {
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

/**
 * The export file, format version 1 (008 contracts/export-format.md, FR-012, FR-012a, FR-016). Pure: main
 * reads the rows and writes the zip; this module only names the format and serializes `data.json`.
 */
import type { Reminder } from "../reminder";
import type { Task } from "../task";
import type { TaskEvent } from "../task-events";

export const EXPORT_FORMAT = "vesta-export";
export const FORMAT_VERSION = 1;

/** About the longest string V8 can hold: neither side could handle a larger `data.json` (research §2, §3). */
export { MAX_DATA_JSON_BYTES } from "../limits";

/**
 * The user settings that travel (PRD B2). 009 appended "logLevel" and "autoUpdateCheck" without a version change
 * (FR-012a); the local "updateNotice" state never travels (009 FR-024a).
 */
export const EXPORTED_SETTING_KEYS = [
  "alertPeriodMin",
  "reblinkIntervalMin",
  "rescheduleToleranceMin",
  // 015 FR-023: the quick reschedule durations, each merged on its own.
  "quickReschedule1Min",
  "quickReschedule2Min",
  "quickReschedule3Min",
  "quickReschedule4Min",
  "theme",
  "language",
  "shortcuts",
  "panelWidth",
  "remindersCollapsed",
  "logLevel",
  "autoUpdateCheck",
  "updateReminder",
  "updateReminderDays",
  // 011 FR-017: the color picker's lists and the order of table sizes.
  "pinnedColors",
  "recentColors",
  "tableRowsFirst",
  // 016 FR-022: the Text color swatch.
  "lastTextColor",
  // HIG identity: the color theme.
  "palette",
  // 018 FR-016a: the automatic cleanups; their change times are local state and stay out.
  "archiveCleanupOn",
  "archiveCleanupHours",
  "trashCleanupOn",
  "trashCleanupHours",
] as const;

export type ExportedSettingKey = (typeof EXPORTED_SETTING_KEYS)[number];

export function isExportedSettingKey(key: string): key is ExportedSettingKey {
  return (EXPORTED_SETTING_KEYS as readonly string[]).includes(key);
}

/** One setting: the parsed JSON value the `settings` table stores, and its last-change time. */
export interface ExportSetting {
  key: ExportedSettingKey;
  value: unknown;
  updatedAt: number;
}

/** One stored file in the zip, as `assets/<sha256>[.<ext>]`. */
export interface ExportAsset {
  sha256: string;
  ext: string;
  mimeType: string;
  size: number;
}

export interface ExportData {
  appVersion: string;
  /** UTC ms. */
  exportedAt: number;
  tasks: Task[];
  /** 015: the tasks' history events, without their recording order (the array's order carries it); none in older files. */
  taskEvents?: TaskEvent[];
  reminders: Reminder[];
  settings: ExportSetting[];
  /** Only the files present in the zip (PRD Q118). */
  assets: ExportAsset[];
}

/** Every Task field, in file order; the Record forces the list to stay complete as Task grows. */
const TASK_FIELD_SET: Record<keyof Task, true> = {
  id: true,
  parentId: true,
  titleMd: true,
  detailsMd: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  doneAt: true,
  deletedAt: true,
  collapsed: true,
  prevSiblingId: true,
  nextSiblingId: true,
  leftWithId: true,
  alertOverrideMin: true,
  staleBaseAt: true,
  staleSince: true,
  wasStale: true,
  lastBlinkAt: true,
  firstBlinkCount: true,
  manuallyPositioned: true,
  lastSignalAt: true,
  rescheduleForMin: true,
  keptDoneAt: true,
};

const REMINDER_FIELD_SET: Record<keyof Reminder, true> = {
  id: true,
  textMd: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  doneAt: true,
  deletedAt: true,
  prevSiblingId: true,
  nextSiblingId: true,
  keptDoneAt: true,
};

export const TASK_FIELDS = Object.keys(TASK_FIELD_SET) as readonly (keyof Task)[];
export const REMINDER_FIELDS = Object.keys(REMINDER_FIELD_SET) as readonly (keyof Reminder)[];

function pick<T extends object>(row: T, fields: readonly (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f as string] = row[f];
  return out;
}

/** `data.json`: the header, then the arrays, every item with exactly its domain fields in a fixed order. */
export function toExportJson(data: ExportData): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    formatVersion: FORMAT_VERSION,
    appVersion: data.appVersion,
    exportedAt: data.exportedAt,
    tasks: data.tasks.map((t) => pick(t, TASK_FIELDS)),
    taskEvents: (data.taskEvents ?? []).map((e) => ({ id: e.id, taskId: e.taskId, kind: e.kind, at: e.at, detail: e.detail })),
    reminders: data.reminders.map((r) => pick(r, REMINDER_FIELDS)),
    settings: data.settings.map((s) => ({ key: s.key, value: s.value, updatedAt: s.updatedAt })),
    assets: data.assets.map((a) => ({ sha256: a.sha256, ext: a.ext, mimeType: a.mimeType, size: a.size })),
  });
}

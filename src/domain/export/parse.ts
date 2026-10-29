/**
 * Reading `data.json` (008 data-model "Validation rules", contracts/export-format.md; FR-012a, FR-021, FR-022).
 * Pure: the first rule a file breaks becomes a refusal whose `where` is a field path, never prose (analysis C1).
 * Unknown fields and settings are dropped and reported for the log.
 */
import { CLEANUP_LIMITS } from "../cleanup";
import { ALERT_LIMITS, type AlertSettingKey } from "../alert-settings";
import { isLanguageSetting } from "../language";
import { isLogLevel } from "../logs/levels";
import { isColorList, isHex8, isPinnedList, type PinnedEntry } from "../markdown/colors";
import { PANEL_MAX_PX, PANEL_MIN_PX } from "../panel-width";
import type { Reminder } from "../reminder";
import {
  MAX_DETAILS_CHARS,
  MAX_IMPORT_FILES,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_RECENT_COLORS,
  MAX_REMINDER_CHARS,
  MAX_TITLE_CHARS,
  OVERRIDE_MAX_MINUTES,
  OVERRIDE_MIN_MINUTES,
  REMINDER_TIME_FIELDS,
  TASK_TIME_FIELDS,
  clampTimes,
  isUuid,
} from "../limits";
import { isPaletteSetting, isReminderDays, isThemeSetting } from "../settings";
import { parseCombo } from "../shortcuts/combo";
import type { Task } from "../task";
import { TASK_EVENT_KINDS, type TaskEvent } from "../task-events";
import {
  EXPORT_FORMAT,
  FORMAT_VERSION,
  REMINDER_FIELDS,
  TASK_FIELDS,
  isExportedSettingKey,
  type ExportAsset,
  type ExportData,
  type ExportSetting,
  type ExportedSettingKey,
} from "./format";

/** What made a file damaged; each has its own locale key (contracts/export-format.md "Refusal messages"). */
export type DamageCause = "checksum" | "missingFile" | "sizeMismatch" | "tooLarge" | "invalidField" | "dataTooLarge" | "tooManyFiles" | "tooLargeTotal";

export type Refusal =
  | { kind: "notVesta" }
  | { kind: "newerVersion"; version: number }
  | { kind: "damaged"; cause: DamageCause; where: string };

export type Parsed = { ok: true; data: ExportData; ignored: string[] } | { ok: false; refusal: Refusal };

/** The largest stored file the app accepts (005 FR-029), 100 MB. */
export const MAX_FILE_BYTES = 104_857_600;

class Damaged extends Error {
  constructor(
    readonly where: string,
    readonly damage: DamageCause = "invalidField",
  ) {
    super(where);
  }
}

type Check = (value: unknown) => boolean;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isTimeOrNull: Check = (v) => v === null || isTime(v);
// 010 L1/L14 (contracts/import-rules.md): ids have Vesta's UUID shape, links are bounded, texts share the IPC limits.
const isLink: Check = (v) => v === null || (typeof v === "string" && v.length <= 64);
const textUpTo = (max: number): Check => (v) => typeof v === "string" && v.length <= max;
const isBool: Check = (v) => typeof v === "boolean";
const isPosition: Check = (v) => typeof v === "number" && Number.isFinite(v);
const isId: Check = (v) => typeof v === "string" && isUuid(v);

const TASK_RULES: Record<keyof Task, Check> = {
  id: isId,
  parentId: isLink,
  titleMd: textUpTo(MAX_TITLE_CHARS),
  detailsMd: textUpTo(MAX_DETAILS_CHARS),
  position: isPosition,
  createdAt: isTime,
  updatedAt: isTime,
  doneAt: isTimeOrNull,
  deletedAt: isTimeOrNull,
  collapsed: isBool,
  prevSiblingId: isLink,
  nextSiblingId: isLink,
  leftWithId: isLink,
  alertOverrideMin: (v) => v === null || (typeof v === "number" && Number.isInteger(v) && v >= OVERRIDE_MIN_MINUTES && v <= OVERRIDE_MAX_MINUTES),
  staleBaseAt: isTime,
  staleSince: isTimeOrNull,
  wasStale: isBool,
  lastBlinkAt: isTimeOrNull,
  firstBlinkCount: (v) => v === null || v === 1 || v === 3,
  manuallyPositioned: isBool,
  lastSignalAt: isTimeOrNull,
  rescheduleForMin: (v) =>
    v === null || (typeof v === "number" && Number.isInteger(v) && v >= ALERT_LIMITS.quickReschedule1Min.min && v <= ALERT_LIMITS.quickReschedule1Min.max),
  keptDoneAt: isTimeOrNull,
};

/** Task fields an older export may lack, with the value they take then (`rescheduleForMin` arrived with 015, `keptDoneAt` with 018). */
const TASK_OPTIONAL: Partial<Record<keyof Task, unknown>> = { rescheduleForMin: null, keptDoneAt: null };
/** 018: `keptDoneAt` arrived in format 1, so an older export lacks it. */
const REMINDER_OPTIONAL: Partial<Record<keyof Reminder, unknown>> = { keptDoneAt: null };

const REMINDER_RULES: Record<keyof Reminder, Check> = {
  id: isId,
  textMd: textUpTo(MAX_REMINDER_CHARS),
  position: isPosition,
  createdAt: isTime,
  updatedAt: isTime,
  doneAt: isTimeOrNull,
  deletedAt: isTimeOrNull,
  prevSiblingId: isLink,
  nextSiblingId: isLink,
  keptDoneAt: isTimeOrNull,
};

const isAlertMinutes = (key: AlertSettingKey): Check => (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= ALERT_LIMITS[key].min && v <= ALERT_LIMITS[key].max;

/** Structure only: whether an OS accepts each remap is decided when the set is taken (FR-033, sanitize.ts). */
const isShortcutSet: Check = (v) =>
  isObject(v) &&
  Object.values(v).every(
    (combos) =>
      Array.isArray(combos) &&
      combos.length >= 1 &&
      combos.length <= 2 &&
      combos.every((c) => typeof c === "string" && parseCombo(c) !== null) &&
      new Set(combos).size === combos.length,
  );

/** 018: a cleanup time is a whole number of hours, one hour to 1000 years 364 days 23 hours. */
const isCleanupHours: Check = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= CLEANUP_LIMITS.minTotalHours && v <= CLEANUP_LIMITS.maxTotalHours;

const SETTING_RULES: Record<ExportedSettingKey, Check> = {
  alertPeriodMin: isAlertMinutes("alertPeriodMin"),
  reblinkIntervalMin: isAlertMinutes("reblinkIntervalMin"),
  rescheduleToleranceMin: isAlertMinutes("rescheduleToleranceMin"),
  quickReschedule1Min: isAlertMinutes("quickReschedule1Min"),
  quickReschedule2Min: isAlertMinutes("quickReschedule2Min"),
  quickReschedule3Min: isAlertMinutes("quickReschedule3Min"),
  quickReschedule4Min: isAlertMinutes("quickReschedule4Min"),
  theme: isThemeSetting,
  palette: isPaletteSetting,
  language: isLanguageSetting,
  shortcuts: isShortcutSet,
  panelWidth: (v) => typeof v === "number" && Number.isFinite(v) && v >= PANEL_MIN_PX && v <= PANEL_MAX_PX,
  remindersCollapsed: isBool,
  logLevel: isLogLevel,
  autoUpdateCheck: isBool,
  updateReminder: isBool,
  updateReminderDays: isReminderDays,
  pinnedColors: isPinnedList,
  recentColors: (v) => isColorList(v, MAX_RECENT_COLORS),
  tableRowsFirst: isBool,
  lastTextColor: isHex8,
  archiveCleanupOn: isBool,
  archiveCleanupHours: isCleanupHours,
  trashCleanupOn: isBool,
  trashCleanupHours: isCleanupHours,
};

const SHA256 = /^[0-9a-f]{64}$/;
const EXT = /^(?:[a-z0-9]{1,16})?$/;

function readItems<T extends object>(
  raw: unknown,
  name: "tasks" | "reminders",
  fields: readonly (keyof T)[],
  rules: Record<keyof T, Check>,
  ignored: string[],
  optional: Partial<Record<keyof T, unknown>> = {},
): T[] {
  if (!Array.isArray(raw)) throw new Damaged(name);
  const ids = new Set<unknown>();
  return raw.map((item: unknown, i) => {
    const at = `${name}[${String(i)}]`;
    if (!isObject(item)) throw new Damaged(at);
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const key = f as string;
      if (!(key in item) && key in optional) {
        out[key] = optional[f];
        continue;
      }
      if (!(key in item) || !rules[f](item[key])) throw new Damaged(`${at}.${key}`);
      out[key] = item[key];
    }
    if (out["doneAt"] !== null && out["deletedAt"] !== null) throw new Damaged(`${at}.deletedAt`);
    if (ids.has(out["id"])) throw new Damaged(`${at}.id`);
    ids.add(out["id"]);
    for (const key of Object.keys(item)) if (!(fields as readonly string[]).includes(key)) ignored.push(`${at}.${key}`);
    return out as T;
  });
}

function readSettings(raw: unknown, ignored: string[]): ExportSetting[] {
  if (!Array.isArray(raw)) throw new Damaged("settings");
  const seen = new Set<string>();
  const out: ExportSetting[] = [];
  raw.forEach((item: unknown, i) => {
    const at = `settings[${String(i)}]`;
    if (!isObject(item) || typeof item["key"] !== "string") throw new Damaged(`${at}.key`);
    const key = item["key"];
    if (!isExportedSettingKey(key)) {
      ignored.push(`${at} (${key})`);
      return;
    }
    if (seen.has(key)) throw new Damaged(`${at}.key`);
    seen.add(key);
    if (!("value" in item) || !SETTING_RULES[key](item["value"])) throw new Damaged(`${at}.value`);
    if (!isTime(item["updatedAt"])) throw new Damaged(`${at}.updatedAt`);
    out.push({ key, value: item["value"], updatedAt: item["updatedAt"] as number });
  });
  return out;
}

/** 015 (research §6): the history events; an older file has none. Ids are UUIDs, as the tasks' are. */
function readEvents(raw: unknown): TaskEvent[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Damaged("taskEvents");
  return raw.map((item: unknown, i) => {
    const at = `taskEvents[${String(i)}]`;
    if (!isObject(item)) throw new Damaged(at);
    const checks: Record<string, Check> = {
      id: isId,
      taskId: isId,
      kind: (v) => typeof v === "string" && (TASK_EVENT_KINDS as readonly string[]).includes(v),
      at: isTime,
      detail: (v) => v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0),
    };
    for (const [key, check] of Object.entries(checks)) if (!check(item[key])) throw new Damaged(`${at}.${key}`);
    return { id: item["id"], taskId: item["taskId"], kind: item["kind"], at: item["at"], detail: item["detail"] } as TaskEvent;
  });
}

function readAssets(raw: unknown): ExportAsset[] {
  if (!Array.isArray(raw)) throw new Damaged("assets");
  // 010 L10 (FR-014): the listing is bounded before any file is read.
  if (raw.length > MAX_IMPORT_FILES) throw new Damaged("assets", "tooManyFiles");
  const seen = new Set<string>();
  let total = 0;
  const out: ExportAsset[] = raw.map((item: unknown, i) => {
    const at = `assets[${String(i)}]`;
    if (!isObject(item)) throw new Damaged(at);
    const { sha256, ext, mimeType, size } = item;
    if (typeof sha256 !== "string" || !SHA256.test(sha256) || seen.has(sha256)) throw new Damaged(`${at}.sha256`);
    seen.add(sha256);
    if (typeof ext !== "string" || !EXT.test(ext)) throw new Damaged(`${at}.ext`);
    if (typeof mimeType !== "string" || mimeType.length === 0 || mimeType.length > 255) throw new Damaged(`${at}.mimeType`);
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0) throw new Damaged(`${at}.size`);
    // Named by its file, as the message says "a file is larger than 100 MB" (FR-021, FR-022).
    if (size > MAX_FILE_BYTES) throw new Damaged(ext === "" ? `assets/${sha256}` : `assets/${sha256}.${ext}`, "tooLarge");
    total += size;
    return { sha256, ext, mimeType, size };
  });
  if (total > MAX_IMPORT_TOTAL_BYTES) throw new Damaged("assets", "tooLargeTotal");
  return out;
}

/**
 * 010 L14 (FR-012): every time later than the import moment becomes the import moment, before the merge compares
 * last edits, so a far-future value can pin nothing. The input is not changed; `count` is logged by the caller.
 */
export function clampExportTimes(data: ExportData, now: number): { data: ExportData; count: number } {
  const tasks = clampTimes(data.tasks, TASK_TIME_FIELDS, now);
  const reminders = clampTimes(data.reminders, REMINDER_TIME_FIELDS, now);
  const settings = clampTimes(data.settings, ["updatedAt"], now);
  // 015: an event's time is a time too (010 L14: none later than the import).
  const events = clampTimes(data.taskEvents ?? [], ["at"], now);
  // 011 FR-017: pin times are times too.
  let pinTimes = 0;
  const rows = settings.rows.map((s) => {
    if (s.key !== "pinnedColors") return s;
    const entries = s.value as PinnedEntry[];
    const clamped = clampTimes(entries, ["at"], now);
    pinTimes += clamped.count;
    return clamped.count === 0 ? s : { ...s, value: clamped.rows };
  });
  return {
    data: { ...data, tasks: tasks.rows, taskEvents: events.rows, reminders: reminders.rows, settings: rows },
    count: tasks.count + events.count + reminders.count + settings.count + pinTimes,
  };
}

export function parseExport(text: string): Parsed {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, refusal: { kind: "notVesta" } };
  }
  if (!isObject(root) || root["format"] !== EXPORT_FORMAT) return { ok: false, refusal: { kind: "notVesta" } };
  const version = root["formatVersion"];
  if (typeof version === "number" && Number.isInteger(version) && version > FORMAT_VERSION) {
    return { ok: false, refusal: { kind: "newerVersion", version } };
  }
  const ignored: string[] = [];
  try {
    if (version !== FORMAT_VERSION) throw new Damaged("formatVersion");
    if (typeof root["appVersion"] !== "string") throw new Damaged("appVersion");
    if (!isTime(root["exportedAt"])) throw new Damaged("exportedAt");
    const tasks = readItems<Task>(root["tasks"], "tasks", TASK_FIELDS, TASK_RULES, ignored, TASK_OPTIONAL);
    const reminders = readItems<Reminder>(root["reminders"], "reminders", REMINDER_FIELDS, REMINDER_RULES, ignored, REMINDER_OPTIONAL);
    const settings = readSettings(root["settings"], ignored);
    const assets = readAssets(root["assets"]);
    const data: ExportData = {
      appVersion: root["appVersion"],
      exportedAt: root["exportedAt"] as number,
      tasks,
      taskEvents: readEvents(root["taskEvents"]),
      reminders,
      settings,
      assets,
    };
    return { ok: true, data, ignored };
  } catch (err) {
    if (err instanceof Damaged) return { ok: false, refusal: { kind: "damaged", cause: err.damage, where: err.where } };
    throw err;
  }
}

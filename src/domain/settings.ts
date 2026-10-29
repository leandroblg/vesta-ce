/** Theme, language and shortcut settings as stored (007 FR-038, data-model "Persisted", research §7). */
import { CLEANUP_LIMITS, DEFAULT_CLEANUP, type CleanupSettingKey, type CleanupSettings, type CleanupWhich } from "./cleanup";
import { isLanguageSetting, type LanguageSetting } from "./language";
import { isLogLevel, type LogLevel } from "./logs/levels";
import { MAX_RECENT_COLORS, REMINDER_DAYS_DEFAULT, REMINDER_DAYS_MAX, REMINDER_DAYS_MIN } from "./limits";
import { isColorList, isHex8, isPinnedList, type Hex8, type PinnedEntry } from "./markdown/colors";
import { normalizeOverrides, type ShortcutOverrides } from "./shortcuts/map";

export type ThemeSetting = "light" | "dark" | "system";

/**
 * The color theme (HIG identity work): a palette that changes colors only. "hearth" is Vesta's own
 * identity; "system", "ubuntu" and "minimal" are the three proposed in the HIG review doc. The Light/Dark/System
 * choice (`ThemeSetting`, the Appearance) is independent of it: every palette has a light and a dark rendering.
 */
export const PALETTES = ["hearth", "system", "ubuntu", "minimal"] as const;
export type PaletteSetting = (typeof PALETTES)[number];
export const DEFAULT_PALETTE: PaletteSetting = "hearth";

export interface UiSettings {
  theme: ThemeSetting;
  palette: PaletteSetting;
  language: LanguageSetting;
  shortcuts: ShortcutOverrides;
}

export const UI_SETTING_KEYS = ["theme", "palette", "language", "shortcuts"] as const;
export type UiSettingKey = (typeof UI_SETTING_KEYS)[number];

export type UiSettingIssue =
  | { key: UiSettingKey; kind: "missing" | "unreadable" }
  | { key: "shortcuts"; kind: "entry"; action: string | null };

export const DEFAULT_UI_SETTINGS: Readonly<UiSettings> = Object.freeze({ theme: "system", palette: DEFAULT_PALETTE, language: "system", shortcuts: {} });

export function isThemeSetting(value: unknown): value is ThemeSetting {
  return value === "light" || value === "dark" || value === "system";
}

export function isPaletteSetting(value: unknown): value is PaletteSetting {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Stored JSON text → usable settings; every value not used as stored is reported, entry by entry for the map. */
export function normalizeUiSettings(raw: Readonly<Record<string, string | undefined>>, isMac: boolean): { settings: UiSettings; issues: UiSettingIssue[] } {
  const issues: UiSettingIssue[] = [];
  const settings: UiSettings = { ...DEFAULT_UI_SETTINGS, shortcuts: {} };

  const theme = raw["theme"];
  if (theme === undefined) issues.push({ key: "theme", kind: "missing" });
  else {
    const v = parse(theme);
    if (isThemeSetting(v)) settings.theme = v;
    else issues.push({ key: "theme", kind: "unreadable" });
  }

  const palette = raw["palette"];
  if (palette === undefined) issues.push({ key: "palette", kind: "missing" });
  else {
    const v = parse(palette);
    if (isPaletteSetting(v)) settings.palette = v;
    else issues.push({ key: "palette", kind: "unreadable" });
  }

  const language = raw["language"];
  if (language === undefined) issues.push({ key: "language", kind: "missing" });
  else {
    const v = parse(language);
    if (isLanguageSetting(v)) settings.language = v;
    else issues.push({ key: "language", kind: "unreadable" });
  }

  const shortcuts = raw["shortcuts"];
  if (shortcuts === undefined) issues.push({ key: "shortcuts", kind: "missing" });
  else {
    const v = parse(shortcuts);
    if (v === undefined) issues.push({ key: "shortcuts", kind: "unreadable" });
    else {
      const { overrides, issues: entryIssues } = normalizeOverrides(v, isMac);
      settings.shortcuts = overrides;
      for (const i of entryIssues) {
        if (i.action === null) issues.push({ key: "shortcuts", kind: "unreadable" });
        else issues.push({ key: "shortcuts", kind: "entry", action: i.action });
      }
    }
  }
  return { settings, issues };
}

/** 009: the log level, the automatic update check and the announced version, as stored (data-model "Database"). */
export interface UpdateNotice {
  version: string;
  seen: boolean;
}

export interface LogSettings {
  logLevel: LogLevel;
  autoUpdateCheck: boolean;
  updateNotice: UpdateNotice | null;
  /** 010 Q133: the reminder while automatic checks are off (default on, every 30 days) and its local anchor. */
  updateReminder: boolean;
  updateReminderDays: number;
  updateReminderAnchor: number | null;
}

/** A whole number of days from 7 to 365 (PRD Q133). */
export function isReminderDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= REMINDER_DAYS_MIN && value <= REMINDER_DAYS_MAX;
}

export type LogSettingIssue = {
  key: "logLevel" | "autoUpdateCheck" | "updateNotice" | "updateReminder" | "updateReminderDays" | "updateReminderAnchor";
  kind: "missing" | "unreadable";
};

const VERSION_TEXT = /^\d+\.\d+\.\d+$/;

function isUpdateNotice(v: unknown): v is UpdateNotice {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["version"] === "string" && VERSION_TEXT.test(o["version"]) && typeof o["seen"] === "boolean";
}

/** Rows not used as stored are reported; `updateNotice` has no row until the first announcement (FR-024a). */
export function normalizeLogSettings(raw: Readonly<Record<string, string | undefined>>): LogSettings & { issues: LogSettingIssue[] } {
  const issues: LogSettingIssue[] = [];
  let logLevel: LogLevel = "info";
  let autoUpdateCheck = true;
  let updateNotice: UpdateNotice | null = null;

  const level = raw["logLevel"];
  if (level === undefined) issues.push({ key: "logLevel", kind: "missing" });
  else {
    const v = parse(level);
    if (isLogLevel(v)) logLevel = v;
    else issues.push({ key: "logLevel", kind: "unreadable" });
  }

  const auto = raw["autoUpdateCheck"];
  if (auto === undefined) issues.push({ key: "autoUpdateCheck", kind: "missing" });
  else {
    const v = parse(auto);
    if (typeof v === "boolean") autoUpdateCheck = v;
    else issues.push({ key: "autoUpdateCheck", kind: "unreadable" });
  }

  const notice = raw["updateNotice"];
  if (notice !== undefined) {
    const v = parse(notice);
    if (isUpdateNotice(v)) updateNotice = { version: v.version, seen: v.seen };
    else issues.push({ key: "updateNotice", kind: "unreadable" });
  }
  let updateReminder = true;
  const reminder = raw["updateReminder"];
  if (reminder === undefined) issues.push({ key: "updateReminder", kind: "missing" });
  else {
    const v = parse(reminder);
    if (typeof v === "boolean") updateReminder = v;
    else issues.push({ key: "updateReminder", kind: "unreadable" });
  }

  let updateReminderDays: number = REMINDER_DAYS_DEFAULT;
  const days = raw["updateReminderDays"];
  if (days === undefined) issues.push({ key: "updateReminderDays", kind: "missing" });
  else {
    const v = parse(days);
    if (isReminderDays(v)) updateReminderDays = v;
    else issues.push({ key: "updateReminderDays", kind: "unreadable" });
  }

  // Local state, written on demand: no row is not an issue.
  let updateReminderAnchor: number | null = null;
  const anchor = raw["updateReminderAnchor"];
  if (anchor !== undefined) {
    const v = parse(anchor);
    if (typeof v === "number" && Number.isFinite(v)) updateReminderAnchor = v;
    else issues.push({ key: "updateReminderAnchor", kind: "unreadable" });
  }
  return { logLevel, autoUpdateCheck, updateNotice, updateReminder, updateReminderDays, updateReminderAnchor, issues };
}

/** 011 FR-016: the color picker's lists and the order of table sizes, as stored. */
export interface EditorSettings {
  pinnedColors: PinnedEntry[];
  recentColors: Hex8[];
  tableRowsFirst: boolean;
  /** 016 FR-019, FR-022 (PRD Q230): the Text color swatch, the last text color picked. */
  lastTextColor: Hex8;
}

/** 016 FR-019: the Hearth ember until a text color is picked. */
export const DEFAULT_TEXT_COLOR: Hex8 = "#b9411cff";

export const EDITOR_SETTING_KEYS = ["pinnedColors", "recentColors", "tableRowsFirst", "lastTextColor"] as const;
export type EditorSettingIssue = { key: (typeof EDITOR_SETTING_KEYS)[number]; kind: "missing" | "unreadable" };

/** Rows not used as stored fall back to the defaults (`[]`, `[]`, `false`) and are reported (011 FR-016). */
export function normalizeEditorSettings(
  raw: Readonly<Record<string, string | undefined>>,
): EditorSettings & { issues: EditorSettingIssue[] } {
  const issues: EditorSettingIssue[] = [];
  const read = <T>(key: EditorSettingIssue["key"], check: (v: unknown) => v is T, fallback: T): T => {
    const text = raw[key];
    if (text === undefined) {
      issues.push({ key, kind: "missing" });
      return fallback;
    }
    const v = parse(text);
    if (check(v)) return v;
    issues.push({ key, kind: "unreadable" });
    return fallback;
  };
  const pinnedColors = read("pinnedColors", isPinnedList, []);
  const recentColors = read("recentColors", (v): v is Hex8[] => isColorList(v, MAX_RECENT_COLORS), []);
  const tableRowsFirst = read("tableRowsFirst", (v): v is boolean => typeof v === "boolean", false);
  // 016 FR-022: no row yet is the default, not an issue (no migration seeds it); an invalid one is reported.
  const lastTextColor =
    raw["lastTextColor"] === undefined ? DEFAULT_TEXT_COLOR : read("lastTextColor", isHex8, DEFAULT_TEXT_COLOR);
  return { pinnedColors, recentColors, tableRowsFirst, lastTextColor, issues };
}

/** 018 (research §5): a cleanup row that is missing or unreadable falls back to its default and is reported. */
export type CleanupSettingIssue = { key: CleanupSettingKey; kind: "missing" | "unreadable" };

export interface CleanupState {
  settings: CleanupSettings;
  /** The time of each cleanup's last saved change, local state never exported; absent = no pending hour (FR-020b). */
  changedAt: Partial<Record<CleanupWhich, number>>;
}

export function normalizeCleanupSettings(raw: Readonly<Record<string, string | undefined>>): CleanupState & { issues: CleanupSettingIssue[] } {
  const issues: CleanupSettingIssue[] = [];
  const settings: CleanupSettings = { archive: { ...DEFAULT_CLEANUP.archive }, trash: { ...DEFAULT_CLEANUP.trash } };
  const changedAt: Partial<Record<CleanupWhich, number>> = {};
  for (const which of ["archive", "trash"] as const) {
    const onKey: CleanupSettingKey = `${which}CleanupOn`;
    const on = raw[onKey];
    if (on === undefined) issues.push({ key: onKey, kind: "missing" });
    else {
      const v = parse(on);
      if (typeof v === "boolean") settings[which].on = v;
      else issues.push({ key: onKey, kind: "unreadable" });
    }
    const hoursKey: CleanupSettingKey = `${which}CleanupHours`;
    const hours = raw[hoursKey];
    if (hours === undefined) issues.push({ key: hoursKey, kind: "missing" });
    else {
      const v = parse(hours);
      if (typeof v === "number" && Number.isInteger(v) && v >= CLEANUP_LIMITS.minTotalHours && v <= CLEANUP_LIMITS.maxTotalHours) settings[which].hours = v;
      else issues.push({ key: hoursKey, kind: "unreadable" });
    }
    const at = raw[`${which}CleanupChangedAt`];
    if (at !== undefined) {
      const v = parse(at);
      if (typeof v === "number" && Number.isInteger(v) && v >= 0) changedAt[which] = v;
    }
  }
  return { settings, changedAt, issues };
}

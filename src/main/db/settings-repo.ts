/** Settings: the three alert settings (003 FR-001), the panel width (005 FR-005), theme, language and shortcuts (007). */
import type Database from "better-sqlite3";
import { PANEL_DEFAULT_PX, clampPanelWidth } from "../../domain/panel-width";
import { ALERT_SETTING_KEYS, normalizeAlertSettings, type AlertSettingKey, type AlertSettings, type SettingIssue } from "../../domain/alert-settings";
import type { LanguageSetting } from "../../domain/language";
import type { LogLevel } from "../../domain/logs/levels";
import { cleanRecent, stampPinned, type Hex8 } from "../../domain/markdown/colors";
import {
  normalizeCleanupSettings,
  normalizeEditorSettings,
  normalizeLogSettings,
  normalizeUiSettings,
  type CleanupSettingIssue,
  type CleanupState,
  type EditorSettingIssue,
  type EditorSettings,
  type LogSettingIssue,
  type LogSettings,
  type PaletteSetting,
  type ThemeSetting,
  type UiSettingIssue,
  type UiSettings,
  type UpdateNotice,
} from "../../domain/settings";
import type { ShortcutOverrides } from "../../domain/shortcuts/map";
import type { CleanupWhich } from "../../domain/cleanup";
import { faultActive } from "../faults";

/** Reads the three alert settings from the `settings` table, normalized (003 FR-001). */
export function loadAlertSettings(db: Database.Database): { settings: AlertSettings; issues: SettingIssue[] } {
  const placeholders = ALERT_SETTING_KEYS.map(() => "?").join(", ");
  const rows = db.prepare(`select key, value from settings where key in (${placeholders})`).all(...ALERT_SETTING_KEYS) as {
    key: string;
    value: string;
  }[];
  return normalizeAlertSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

const PANEL_KEY = "panelWidth";

/** The stored panel width, clamped to 300–760 (005 FR-005); an issue when the stored value was not used as is. */
export function loadPanelWidth(db: Database.Database): { px: number; issue: "missing" | "unreadable" | "clamped" | null } {
  const row = db.prepare("select value from settings where key = ?").get(PANEL_KEY) as { value: string } | undefined;
  if (row === undefined) return { px: PANEL_DEFAULT_PX, issue: "missing" };
  const value: unknown = (() => {
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return null;
    }
  })();
  if (typeof value !== "number" || !Number.isFinite(value)) return { px: PANEL_DEFAULT_PX, issue: "unreadable" };
  const px = clampPanelWidth(value);
  return { px, issue: px === value ? null : "clamped" };
}

export function savePanelWidth(db: Database.Database, px: number, now: number): void {
  db.prepare(
    "insert into settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at",
  ).run(PANEL_KEY, JSON.stringify(clampPanelWidth(px)), now);
}

/** One settings row; VESTA_FAULT=save makes it fail like every other write (007 FR-039). */
function upsert(db: Database.Database, key: string, value: string, now: number): void {
  if (faultActive("save")) throw new Error("VESTA_FAULT=save");
  db.prepare(UPSERT).run(key, value, now);
}

const UPSERT =
  "insert into settings (key, value, updated_at) values (?, ?, ?) on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at";

/** Theme, language and shortcut overrides, normalized (007 FR-038, research §7). */
export function loadUiSettings(db: Database.Database, isMac: boolean): { settings: UiSettings; issues: UiSettingIssue[] } {
  const rows = db.prepare("select key, value from settings where key in ('theme', 'palette', 'language', 'shortcuts')").all() as {
    key: string;
    value: string;
  }[];
  return normalizeUiSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])), isMac);
}

/** One alert setting, already validated against ALERT_LIMITS (007 FR-005 to FR-007). */
export function saveAlertSetting(db: Database.Database, key: AlertSettingKey, minutes: number, now: number): void {
  upsert(db, key, JSON.stringify(minutes), now);
}

export function saveTheme(db: Database.Database, theme: ThemeSetting, now: number): void {
  upsert(db, "theme", JSON.stringify(theme), now);
}

export function savePalette(db: Database.Database, palette: PaletteSetting, now: number): void {
  upsert(db, "palette", JSON.stringify(palette), now);
}

export function saveLanguage(db: Database.Database, setting: LanguageSetting, now: number): void {
  upsert(db, "language", JSON.stringify(setting), now);
}

/** Overrides only; Reset to defaults stores `{}` (FR-036). */
export function saveShortcuts(db: Database.Database, overrides: ShortcutOverrides, now: number): void {
  upsert(db, "shortcuts", JSON.stringify(overrides), now);
}

/** 009: the log level, the automatic update check and the announced version (data-model "Database"). */
export function loadLogSettings(db: Database.Database): LogSettings & { issues: LogSettingIssue[] } {
  const rows = db.prepare("select key, value from settings where key in ('logLevel', 'autoUpdateCheck', 'updateNotice', 'updateReminder', 'updateReminderDays', 'updateReminderAnchor')").all() as {
    key: string;
    value: string;
  }[];
  return normalizeLogSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

export function saveLogLevel(db: Database.Database, level: LogLevel, now: number): void {
  upsert(db, "logLevel", JSON.stringify(level), now);
}

export function saveAutoUpdateCheck(db: Database.Database, on: boolean, now: number): void {
  upsert(db, "autoUpdateCheck", JSON.stringify(on), now);
}

/** Local app state, not a user setting: never exported (FR-024a), and not subject to the save fault. */
export function saveUpdateNotice(db: Database.Database, notice: UpdateNotice, now: number): void {
  db.prepare(UPSERT).run("updateNotice", JSON.stringify({ version: notice.version, seen: notice.seen }), now);
}

/** 010 Q133: the reminder switch and period are user settings (exported); the anchor is local state. */
export function saveUpdateReminder(db: Database.Database, on: boolean, now: number): void {
  upsert(db, "updateReminder", JSON.stringify(on), now);
}

export function saveUpdateReminderDays(db: Database.Database, days: number, now: number): void {
  upsert(db, "updateReminderDays", JSON.stringify(days), now);
}

/** The latest of: automatic checks turned off, a completed check, a reminder sent (never exported). */
export function saveUpdateReminderAnchor(db: Database.Database, at: number, now: number): void {
  db.prepare(UPSERT).run("updateReminderAnchor", JSON.stringify(at), now);
}

/** 018 (research §5): the two cleanups' switches and times, and their local change times. */
export function loadCleanupSettings(db: Database.Database): CleanupState & { issues: CleanupSettingIssue[] } {
  const rows = db.prepare("select key, value from settings where key like 'archiveCleanup%' or key like 'trashCleanup%'").all() as {
    key: string;
    value: string;
  }[];
  return normalizeCleanupSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/** One saved cleanup change: its switch, time and change time in one transaction (FR-020b); the save fault applies. */
export function saveCleanupSetting(db: Database.Database, which: CleanupWhich, on: boolean, hours: number, now: number): void {
  db.transaction(() => {
    upsert(db, `${which}CleanupOn`, JSON.stringify(on), now);
    upsert(db, `${which}CleanupHours`, JSON.stringify(hours), now);
    writeCleanupChangedAt(db, which, now);
  })();
}

/** The change time alone (an import or an Undo import that changed a cleanup row): local state, never exported. */
export function writeCleanupChangedAt(db: Database.Database, which: CleanupWhich, now: number): void {
  db.prepare(UPSERT).run(`${which}CleanupChangedAt`, JSON.stringify(now), now);
}

const ASSET_TYPES_KEY = "assetTypesRecomputed";

/** 010 M2: whether the one-time recomputation of stored file types has run (local state, never exported). */
export function loadAssetTypesRecomputed(db: Database.Database): boolean {
  const row = db.prepare("select value from settings where key = ?").get(ASSET_TYPES_KEY) as { value: string } | undefined;
  return row?.value === "true";
}

export function saveAssetTypesRecomputed(db: Database.Database, now: number): void {
  db.prepare(UPSERT).run(ASSET_TYPES_KEY, "true", now);
}

/** 011 FR-016: the color picker's lists and the order of table sizes. */
export function loadEditorSettings(db: Database.Database): EditorSettings & { issues: EditorSettingIssue[] } {
  const rows = db.prepare("select key, value from settings where key in ('pinnedColors', 'recentColors', 'tableRowsFirst', 'lastTextColor')").all() as {
    key: string;
    value: string;
  }[];
  return normalizeEditorSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

/**
 * Writes only the lists present, in one transaction, each stamped with `now` (contracts/ipc.md). Pinned colors
 * arrive as a hex order: new ones and `pinnedNow` get `now` as their pin time, the others keep theirs. The saved
 * recent list never holds a pinned or preset color (FR-012, PRD Q145).
 */
export function saveColorLists(
  db: Database.Database,
  next: { pinned?: readonly Hex8[]; recent?: readonly Hex8[]; pinnedNow?: Hex8 },
  now: number,
): void {
  if (faultActive("save")) throw new Error("VESTA_FAULT=save");
  db.transaction(() => {
    const stored = loadEditorSettings(db);
    const pinned = next.pinned === undefined ? stored.pinnedColors : stampPinned(stored.pinnedColors, next.pinned, now, next.pinnedNow);
    if (next.pinned !== undefined) db.prepare(UPSERT).run("pinnedColors", JSON.stringify(pinned), now);
    const recentIn = next.recent ?? stored.recentColors;
    const recent = cleanRecent(recentIn, pinned.map((e) => e.hex));
    const recentChanged = next.recent !== undefined || recent.length !== stored.recentColors.length;
    if (recentChanged) db.prepare(UPSERT).run("recentColors", JSON.stringify(recent), now);
  })();
}

export function saveTableRowsFirst(db: Database.Database, on: boolean, now: number): void {
  upsert(db, "tableRowsFirst", JSON.stringify(on), now);
}

/** 016 FR-022 (PRD Q230): the Text color swatch, written when a text color is picked. */
export function saveLastTextColor(db: Database.Database, hex: Hex8, now: number): void {
  upsert(db, "lastTextColor", JSON.stringify(hex), now);
}

const COLORS_REWRITTEN_KEY = "colorsRewritten";

/** 011 FR-015: whether the one-time rewrite of stored colors to 8 digits has run (local state, never exported). */
export function loadColorsRewritten(db: Database.Database): boolean {
  const row = db.prepare("select value from settings where key = ?").get(COLORS_REWRITTEN_KEY) as { value: string } | undefined;
  return row?.value === "true";
}

export function saveColorsRewritten(db: Database.Database, now: number): void {
  db.prepare(UPSERT).run(COLORS_REWRITTEN_KEY, "true", now);
}

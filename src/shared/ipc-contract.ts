/**
 * The renderer ↔ main contract (contracts/ipc.md, constitution II). Main registers handlers only for
 * INVOKE_CHANNELS; the preload exposes only METHODS and EVENT_CHANNELS.
 */
import type { AlertSettingKey, AlertSettings } from "../domain/alert-settings";
import type { Lang, LanguageSetting } from "../domain/language";
import type { MenuCommandId } from "../domain/menu/commands";
import type { CommandState } from "../domain/menu/state";
import type { LogLevel } from "../domain/logs/levels";
import type { PaletteSetting, ThemeSetting } from "../domain/settings";
import type { ShortcutOverrides } from "../domain/shortcuts/map";
import type { MoveDest } from "../domain/move";
import type { Reminder } from "../domain/reminder";
import type { StartupOutcome } from "../domain/startup-outcome";
import type { Task } from "../domain/task";
import type { TaskEvent } from "../domain/task-events";

/** 010 M1: INSIDE_DATA refuses a path inside the data folder; CANCELLED is the user declining the confirmation. */
export type ErrorCode = "SAVE_FAILED" | "NOT_FOUND" | "INVALID" | "UNDO_EXPIRED" | "TOO_LARGE" | "NOT_IMAGE" | "INSIDE_DATA" | "CANCELLED";

export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: ErrorCode; message: string } };

export type TaskDTO = Task;

/** One history entry as the renderer gets it (015 contracts/ipc.md); `seq` is set on every event read back. */
export type TaskEventDTO = TaskEvent;

/** A stored file as the renderer knows it (005): never a file path. `ref` = "assets/<sha256>[.<ext>]". */
export interface AssetRef {
  ref: string;
  name: string;
  isImage: boolean;
}

/** Where a file goes: a title or reminder takes images only (005 FR-029). */
export type AssetScope = "title" | "details";
export type ReminderDTO = Reminder;

/**
 * The rows one action changed. Task channels set only `upserts`/`removals`; reminder channels set
 * `reminders`, and `remindersCollapsed` when the section's state changed (contracts/ipc.md, 002).
 */
export interface Mutation {
  upserts: TaskDTO[];
  removals: string[];
  reminders?: { upserts: ReminderDTO[]; removals: string[] };
  remindersCollapsed?: boolean;
  /** The history events this call inserted or updated, and the ids it removed (015 research §5). */
  events?: { upserts: TaskEventDTO[]; removals: string[] };
}

export interface UndoableMutation extends Mutation {
  undoToken: string;
}

/** 016 FR-003 (PRD Q228): an undo of a reschedule also offers its redo. */
export interface UndoReply extends Mutation {
  redoToken?: string;
}

export type { AlertSettings, AlertSettingKey, Lang, LanguageSetting, LogLevel, MoveDest, ShortcutOverrides, ThemeSetting };

/** A key-down seen by main while capturing a shortcut (007 research §11). */
export interface CapturedKey {
  key: string;
  code: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
}

/** A blink episode to play now on one row (003 FR-016 to FR-021a); never stored. */
export interface Episode {
  id: string;
  blinks: 1 | 3;
}

/** The reply of alerts:tick: rows whose alert fields changed, the episodes to play, main's time. */
export interface AlertTick extends Mutation {
  episodes: Episode[];
  now: number;
}

export interface InitialState {
  tasks: TaskDTO[];
  reminders: ReminderDTO[];
  remindersCollapsed: boolean;
  startup: StartupOutcome;
  now: number;
  alertSettings: AlertSettings;
  /** Unpackaged builds only: the renderer defines window.__vestaTest (004 research §8). */
  testHooks: boolean;
  /** The details panel's width in px, 300 to 760 (005 FR-005). */
  panelWidth: number;
  /** 007: the stored theme (main has already applied it), language setting, active language and shortcut overrides. */
  theme: ThemeSetting;
  /** HIG identity: the color theme; `theme` above is the Appearance (light, dark, system). */
  palette: PaletteSetting;
  languageSetting: LanguageSetting;
  language: Lang;
  shortcuts: ShortcutOverrides;
  /** process.platform === "darwin": the shortcut defaults and notation depend on it (007 research §9). */
  isMac: boolean;
  /** 009: the stored log level (filters the viewer, sets the recording floor) and the automatic update check. */
  logLevel: LogLevel;
  autoUpdateCheck: boolean;
  /** 010 Q133: the update reminder while automatic checks are off, and its period in days (7 to 365). */
  updateReminder: boolean;
  updateReminderDays: number;
  /** 011 FR-016: the color picker's pinned colors (hex order of the stored entries) and recent colors, and the order of table sizes. */
  pinnedColors: string[];
  recentColors: string[];
  tableRowsFirst: boolean;
  /** 016 FR-019: the Text color swatch (Hex8). */
  lastTextColor: string;
  /** 009: `app.getVersion()`, for About and the update messages. */
  appVersion: string;
  /** 009: the update check as main knows it this session. */
  update: UpdateState;
  /** 018 FR-014, FR-020d: each cleanup's switch and time, and the time left of its hour after a change (null: none). */
  cleanup: { archive: CleanupView; trash: CleanupView };
}

/** 018 contracts/ipc-cleanup.md: a cleanup as Settings shows it; `remainingMs` is in main's clock. */
export interface CleanupView {
  on: boolean;
  hours: number;
  remainingMs: number | null;
}

/** 018 the reply to a cleanup change: `pending` when it needs a dialog that a commit has not asked yet (Q282, Q287). */
export interface CleanupSaveResult extends CleanupView {
  saved: boolean;
  pending: boolean;
}

/** 008: what an import or Undo import replaces in the renderer (InitialState minus startup, testHooks, isMac). */
export type DataSnapshot = Omit<InitialState, "startup" | "testHooks" | "isMac" | "appVersion" | "update">;

/** 009 contracts/ipc.md: where the next older page of the log starts. `file` is a log file name, never a path. */
export interface LogCursor {
  file: string;
  offset: number;
}

/** One log line for the viewer; a line Vesta cannot read has `raw` set and `level` null. */
export interface LogLine {
  /** Epoch ms (UTC); the renderer formats it with the local offset (FR-016). */
  time: number | null;
  level: LogLevel | null;
  event: string | null;
  fields: Record<string, unknown>;
  raw: string | null;
  cut: boolean;
}

export interface LogPage {
  /** Newest first (PRD Q127); at most 400. */
  lines: LogLine[];
  /** null: the oldest entry is reached. */
  older: LogCursor | null;
  /** Rotation deleted the file being read (FR-019). */
  removedOlder: boolean;
  /** The logs folder could not be read (FR-019). */
  unreadable: boolean;
}

export type UpdateSystem = "macOS" | "Linux" | "Windows";

export type UpdateResult =
  | { kind: "none" }
  | { kind: "upToDate"; checkedAt: number }
  | { kind: "available"; checkedAt: number; version: string; notes: string; hasFile: boolean; system: UpdateSystem }
  | { kind: "failed"; checkedAt: number; manual: boolean };

export interface UpdateState {
  checking: boolean;
  auto: boolean;
  result: UpdateResult;
  /** The cogwheel mark (FR-024, FR-024a). */
  mark: boolean;
  /** Set once when a notification must be queued; the renderer turns it into a showUpdate event. */
  announce: { version: string } | null;
}

/** 008 contracts/ipc.md. `folder` is display text only. */
export type ExportOutcome =
  | { kind: "cancelled" }
  /** 017 FR-015a (PRD Q267, Q269): the data was saved by a newer version of Vesta; refused before any dialog. */
  | { kind: "dataRefused" }
  | { kind: "written"; fileName: string; folder: string; skippedFiles: number }
  | { kind: "failed" };

export type DamageCause = "checksum" | "missingFile" | "sizeMismatch" | "tooLarge" | "invalidField" | "dataTooLarge" | "tooManyFiles" | "tooLargeTotal";

export type ImportRefusal = { kind: "notVesta" } | { kind: "newerVersion" } | { kind: "damaged"; cause: DamageCause; where: string } | { kind: "noSpace" };

export interface ImportCounts {
  added: number;
  updated: number;
  unchanged: number;
}

export type ImportOutcome =
  | { kind: "cancelled" }
  | { kind: "refused"; refusal: ImportRefusal }
  | { kind: "notStarted" }
  /** 017 FR-015a (PRD Q267, Q269): as for export. */
  | { kind: "dataRefused" }
  | { kind: "failedRestored"; data: DataSnapshot }
  | { kind: "merged"; counts: ImportCounts; undo: { token: string; deadline: number; now: number }; data: DataSnapshot };

export type UndoImportOutcome = { kind: "undone"; data: DataSnapshot } | { kind: "undoFailed" };

/** A search request (006 contracts/ipc.md); `seq` lets the renderer drop late replies. */
export interface SearchQuery {
  seq: number;
  text: string;
  matchCase: boolean;
  exactPhrase: boolean;
  includeArchiveTrash: boolean;
}

/** One matching item; `excerpt` is set when it matched through its details only (006 FR-013). */
export interface SearchMatch {
  kind: "task" | "reminder";
  id: string;
  inTitle: boolean;
  excerpt: string | null;
}

/** `pending`: the index is not complete yet; the renderer waits for `search:indexed` (006 FR-023, FR-025). */
export interface SearchResult {
  seq: number;
  matches: SearchMatch[];
  pending: boolean;
}

export interface InvokeMap {
  "app:get-initial-state": { req: undefined; res: InitialState };
  "app:flush-done": { req: undefined; res: null };
  "app:log-error": { req: { message: string; stack: string | null; context: string }; res: null };
  "tasks:create": { req: { title: string; parentId: string | null }; res: Mutation };
  "tasks:edit-title": { req: { id: string; title: string }; res: Mutation };
  "tasks:set-collapsed": { req: { id: string; collapsed: boolean }; res: Mutation };
  "tasks:mark-done": { req: { id: string }; res: UndoableMutation };
  "tasks:delete": { req: { id: string }; res: UndoableMutation };
  "tasks:restore": { req: { id: string }; res: UndoableMutation };
  "tasks:delete-permanently": { req: { id: string }; res: Mutation };
  /** 015: `forMin` is the chosen quick duration in minutes, or null for the reschedule tolerance. */
  "tasks:reschedule": { req: { id: string; forMin: number | null }; res: UndoableMutation };
  /** 015: one task's recorded history events, in recording order (contracts/ipc.md). */
  "tasks:history": { req: { id: string }; res: TaskEventDTO[] };
  "tasks:set-alert-override": { req: { id: string; minutes: number | null }; res: Mutation };
  "tasks:move": { req: { id: string; dest: MoveDest }; res: Mutation };
  "alerts:tick": { req: { visible: boolean }; res: AlertTick };
  "reminders:create": { req: { text: string }; res: Mutation };
  "reminders:edit-text": { req: { id: string; text: string }; res: Mutation };
  "reminders:set-collapsed": { req: { collapsed: boolean }; res: Mutation };
  "reminders:mark-done": { req: { id: string }; res: UndoableMutation };
  "reminders:delete": { req: { id: string }; res: UndoableMutation };
  "reminders:restore": { req: { id: string }; res: UndoableMutation };
  "reminders:delete-permanently": { req: { id: string }; res: Mutation };
  "reminders:move": { req: { id: string; beforeId: string | null }; res: Mutation };
  "undo:apply": { req: { token: string }; res: UndoReply };
  /** 016 FR-004: reschedules the undone task again for the recorded duration, from now. */
  "undo:redo": { req: { token: string }; res: UndoableMutation };
  "tasks:edit-details": { req: { id: string; details: string }; res: Mutation };
  "assets:import-bytes": { req: { name: string; bytes: Uint8Array; scope: AssetScope }; res: AssetRef };
  "assets:pick": { req: { scope: AssetScope }; res: { refs: AssetRef[]; refused: string[] } };
  "assets:import-path": { req: { path: string; scope: AssetScope }; res: AssetRef };
  "assets:open": { req: { ref: string }; res: null };
  /** 016 FR-016a (PRD Q241): shows a stored file in the file manager. */
  "assets:reveal": { req: { ref: string }; res: null };
  /** 016 FR-016 (PRD Q234): the system clipboard, written in main. */
  "clipboard:write": { req: { text: string; html: string | null }; res: null };
  "app:open-external": { req: { url: string }; res: null };
  "settings:set-panel-width": { req: { px: number }; res: null };
  "search:query": { req: SearchQuery; res: SearchResult };
  /** 012 FR-026: the reply also carries the tasks a new alert period un-staled (contracts/ipc.md). */
  "settings:set-alert": { req: { key: AlertSettingKey; minutes: number }; res: { settings: AlertSettings; tasks: Task[] } };
  "settings:set-theme": { req: { theme: ThemeSetting }; res: null };
  /** HIG identity: the color theme (palette); colors only. */
  "settings:set-palette": { req: { palette: PaletteSetting }; res: null };
  "settings:set-language": { req: { setting: LanguageSetting }; res: { language: Lang } };
  "settings:set-shortcuts": { req: { overrides: ShortcutOverrides }; res: null };
  "window:minimize": { req: undefined; res: null };
  "keys:set-capture": { req: { on: boolean }; res: null };
  "data:export": { req: { includeLogs: boolean }; res: ExportOutcome };
  "data:import": { req: undefined; res: ImportOutcome };
  "data:undo-import": { req: { token: string }; res: UndoImportOutcome };
  "data:end-undo-offer": { req: undefined; res: null };
  "logs:read": { req: { cursor: LogCursor | null; level: LogLevel }; res: LogPage };
  "logs:watch": { req: { on: boolean; level: LogLevel }; res: null };
  "settings:set-log-level": { req: { level: LogLevel }; res: null };
  "settings:set-auto-update-check": { req: { on: boolean }; res: UpdateState };
  "settings:set-update-reminder": { req: { on: boolean }; res: null };
  "settings:set-update-reminder-days": { req: { days: number }; res: null };
  /** 011 contracts/ipc.md: only the non-null lists are written; `pinnedNow` is the color a pin just moved first. */
  "settings:set-color-lists": { req: { pinned: string[] | null; recent: string[] | null; pinnedNow: string | null }; res: null };
  "settings:set-table-rows-first": { req: { on: boolean }; res: null };
  /** 016 FR-022 (PRD Q230): the Text color swatch. */
  "settings:set-last-text-color": { req: { hex: string }; res: null };
  /** 018 FR-020a to FR-020d: a cleanup change; main asks the confirmation when `commit` is true and one is needed. */
  "settings:set-cleanup": { req: { which: "archive" | "trash"; on: boolean; hours: number; commit: boolean }; res: CleanupSaveResult };
  /** 018 FR-020d: each cleanup's time left of its hour, read when the Data pane shows; not a change (no `settings:`). */
  "cleanup:status": { req: undefined; res: { archive: { remainingMs: number | null }; trash: { remainingMs: number | null } } };
  "updates:check": { req: undefined; res: UpdateState };
  /** 013 FR-024 (PRD Q176): the Updates pane is shown; the mark and the Dock badge go. */
  /** 013 FR-024 (T114): the Updates pane appeared (true) or went (false); while shown, a version found is seen. */
  "updates:pane-shown": { req: { shown: boolean }; res: UpdateState };
  /** 013 research §3: the renderer's command state; main enables and checks the menu items from it. */
  "menu:set-state": { req: CommandState; res: null };
  /** 013 FR-018 (PRD Q175): the native confirmation of Delete Permanently. */
  "dialog:confirm-delete-forever": { req: { title: string }; res: { confirmed: boolean } };
  /** 013 FR-008: Vesta Help and Release Notes, fixed URLs only. */
  "app:open-help": { req: { target: "readme" | "release" }; res: null };
  "updates:open": { req: { target: "file" | "release" }; res: null };
}

export type InvokeChannel = keyof InvokeMap;
export type Req<C extends InvokeChannel> = InvokeMap[C]["req"];
export type Res<C extends InvokeChannel> = InvokeMap[C]["res"];

export const INVOKE_CHANNELS = Object.freeze([
  "app:get-initial-state",
  "app:flush-done",
  "app:log-error",
  "tasks:create",
  "tasks:edit-title",
  "tasks:set-collapsed",
  "tasks:mark-done",
  "tasks:delete",
  "tasks:restore",
  "tasks:delete-permanently",
  "tasks:reschedule",
  "tasks:history",
  "tasks:set-alert-override",
  "tasks:move",
  "alerts:tick",
  "reminders:create",
  "reminders:edit-text",
  "reminders:set-collapsed",
  "reminders:mark-done",
  "reminders:delete",
  "reminders:restore",
  "reminders:delete-permanently",
  "reminders:move",
  "undo:apply",
  "undo:redo",
  "tasks:edit-details",
  "assets:import-bytes",
  "assets:pick",
  "assets:import-path",
  "assets:open",
  "assets:reveal",
  "clipboard:write",
  "app:open-external",
  "settings:set-panel-width",
  "search:query",
  "settings:set-alert",
  "settings:set-theme",
  "settings:set-palette",
  "settings:set-language",
  "settings:set-shortcuts",
  "window:minimize",
  "keys:set-capture",
  "data:export",
  "data:import",
  "data:undo-import",
  "data:end-undo-offer",
  "logs:read",
  "logs:watch",
  "settings:set-log-level",
  "settings:set-auto-update-check",
  "settings:set-update-reminder",
  "settings:set-update-reminder-days",
  "settings:set-color-lists",
  "settings:set-table-rows-first",
  "settings:set-last-text-color",
  "settings:set-cleanup",
  "cleanup:status",
  "updates:check",
  "updates:pane-shown",
  "menu:set-state",
  "dialog:confirm-delete-forever",
  "app:open-help",
  "updates:open",
] as const satisfies readonly InvokeChannel[]);

export interface EventMap {
  "tasks:purged": { removals: string[]; reminderRemovals: string[] };
  "notice:backup-failed": { lastBackupAt: number | null };
  "notice:data-damaged": Record<string, never>;
  "app:flush": Record<string, never>;
  /** 013 research §2: a menu item was clicked; the renderer routes the id. */
  "menu:command": { id: MenuCommandId };
  "alerts:wake": Record<string, never>;
  /** A background index fill ended with nothing missing or pending (006 FR-025). */
  "search:indexed": Record<string, never>;
  /** Use system language: the OS list now maps to another language (007 FR-015). */
  "settings:language": { language: Lang };
  /** A key-down while a shortcut capture is on (007 research §11). */
  "keys:captured": CapturedKey;
  /** 009: new log entries for the open viewer, newest first (FR-018). */
  "logs:appended": { lines: LogLine[] };
  /** 009: the update check's state changed. */
  "updates:state": UpdateState;
  /** 010 Q133: a reminder to check for updates is due (contracts/ipc.md). */
  "updates:reminder": { at: number };
}

export type EventChannel = keyof EventMap;

export const EVENT_CHANNELS = Object.freeze([
  "tasks:purged",
  "notice:backup-failed",
  "notice:data-damaged",
  "app:flush",
  "menu:command",
  "alerts:wake",
  "search:indexed",
  "settings:language",
  "keys:captured",
  "logs:appended",
  "updates:state",
  "updates:reminder",
] as const satisfies readonly EventChannel[]);

/** `window.vesta.<group>.<method>` → channel. The preload builds the API from this table only. */
export const METHODS = Object.freeze({
  app: {
    getInitialState: "app:get-initial-state",
    flushDone: "app:flush-done",
    logError: "app:log-error",
    openExternal: "app:open-external",
    openHelp: "app:open-help",
  },
  tasks: {
    create: "tasks:create",
    editTitle: "tasks:edit-title",
    setCollapsed: "tasks:set-collapsed",
    markDone: "tasks:mark-done",
    delete: "tasks:delete",
    restore: "tasks:restore",
    deletePermanently: "tasks:delete-permanently",
    reschedule: "tasks:reschedule",
    history: "tasks:history",
    setAlertOverride: "tasks:set-alert-override",
    move: "tasks:move",
    editDetails: "tasks:edit-details",
  },
  reminders: {
    create: "reminders:create",
    editText: "reminders:edit-text",
    setCollapsed: "reminders:set-collapsed",
    markDone: "reminders:mark-done",
    delete: "reminders:delete",
    restore: "reminders:restore",
    deletePermanently: "reminders:delete-permanently",
    move: "reminders:move",
  },
  undo: { apply: "undo:apply", redo: "undo:redo" },
  assets: { importBytes: "assets:import-bytes", pick: "assets:pick", importPath: "assets:import-path", open: "assets:open", reveal: "assets:reveal" },
  clipboard: { write: "clipboard:write" },
  settings: {
    setPanelWidth: "settings:set-panel-width",
    setAlert: "settings:set-alert",
    setTheme: "settings:set-theme",
    setPalette: "settings:set-palette",
    setLanguage: "settings:set-language",
    setShortcuts: "settings:set-shortcuts",
    setLogLevel: "settings:set-log-level",
    setAutoUpdateCheck: "settings:set-auto-update-check",
    setUpdateReminder: "settings:set-update-reminder",
    setUpdateReminderDays: "settings:set-update-reminder-days",
    setColorLists: "settings:set-color-lists",
    setTableRowsFirst: "settings:set-table-rows-first",
    setLastTextColor: "settings:set-last-text-color",
    setCleanup: "settings:set-cleanup",
  },
  cleanup: { status: "cleanup:status" },
  window: { minimize: "window:minimize" },
  keys: { setCapture: "keys:set-capture" },
  data: { export: "data:export", import: "data:import", undoImport: "data:undo-import", endUndoOffer: "data:end-undo-offer" },
  alerts: { tick: "alerts:tick" },
  search: { query: "search:query" },
  logs: { read: "logs:read", watch: "logs:watch" },
  updates: { check: "updates:check", paneShown: "updates:pane-shown", open: "updates:open" },
  menu: { setState: "menu:set-state" },
  dialog: { confirmDeleteForever: "dialog:confirm-delete-forever" },
} as const);

type Methods = typeof METHODS;

type Invoker<C extends InvokeChannel> = Req<C> extends undefined
  ? () => Promise<Result<Res<C>>>
  : (payload: Req<C>) => Promise<Result<Res<C>>>;

export type VestaApi = {
  [G in keyof Methods]: { [M in keyof Methods[G]]: Methods[G][M] extends InvokeChannel ? Invoker<Methods[G][M]> : never };
} & {
  on<E extends EventChannel>(event: E, handler: (payload: EventMap[E]) => void): () => void;
};

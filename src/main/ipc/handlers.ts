/** One handler per contract channel (contracts/ipc.md). Each validates, runs the domain action, saves. */
import { cleanupViews } from "./cleanup-handlers";
import type Database from "better-sqlite3";
import { isIndexPending } from "../db/search-repo";
import { runSearchQuery } from "../search/query";
import type { IpcMain, WebFrameMain } from "electron";
import {
  create,
  deletePermanently,
  editTitle,
  markDone,
  remove,
  trashDone,
  reschedule,
  restore,
  setAlertOverride,
  setCollapsed,
  editDetails,
} from "../../domain/actions";
import {
  createReminder,
  deleteReminderPermanently,
  editReminderText,
  markReminderDone,
  moveReminder,
  removeReminder,
  trashDoneReminder,
  restoreReminder,
  setRemindersCollapsed,
} from "../../domain/reminder-actions";
import type { AlertSettings } from "../../domain/alert-settings";
import type { Clock } from "../../domain/clock";
import type { StartupOutcome } from "../../domain/startup-outcome";
import type { Reminder, ReminderChangeSet } from "../../domain/reminder";
import type { ChangeSet, Task } from "../../domain/task";
import { applyPeriodChange } from "../../domain/period-change";
import { applyReminderUndo, applyUndo, beforeOf, isReminderUndo, type UndoRecordKind } from "../../domain/undo";
import { evaluateAlerts } from "../../domain/alerts";
import { moveTask } from "../../domain/move";
import {
  INVOKE_CHANNELS,
  type InvokeChannel,
  type AlertTick,
  type AssetRef,
  type Mutation,
  type Req,
  type Res,
  type Result,
  type UndoableMutation,
  type UpdateState,
  type UndoReply,
} from "../../shared/ipc-contract";
import {
  loadAlertSettings,
  loadEditorSettings,
  loadLogSettings,
  loadPanelWidth,
  loadUiSettings,
  saveAlertSetting,
  saveColorLists,
  saveLanguage,
  savePanelWidth,
  savePalette,
  saveShortcuts,
  saveLastTextColor,
  saveTableRowsFirst,
  saveTheme,
} from "../db/settings-repo";
import { ALERT_LIMITS, QUICK_RESCHEDULE_KEYS } from "../../domain/alert-settings";
import type { Lang, LanguageSetting } from "../../domain/language";
import type { ThemeSetting } from "../../domain/settings";
import { normalizeOverrides } from "../../domain/shortcuts/map";
import { DomainError } from "../../domain/task";
import { validatePayload } from "../../shared/validate";
import { applyReminderChangeSet, loadReminders, loadRemindersCollapsed } from "../db/reminders-repo";
import { SaveFailedError, applyChangeSet, loadAll, loadByIds } from "../db/tasks-repo";
import { lastEvents, loadEventsById, loadHistory } from "../db/events-repo";
import { deriveEvents, type EventOrigin, type EventWrite } from "../../domain/task-events";
import { randomUUID } from "node:crypto";
import type { AlertSession } from "../alert-session";
import type { Logger } from "../log";
import type { UndoStore } from "../undo-store";
import { toResult } from "./result";
import { hostOnly } from "../../domain/logs/redact";
import { basename } from "node:path";
import { AssetError, importBytes, importConfirmed, importPath, resolveForImport, type ConfirmRequest } from "../assets/store";
import { openAsset, openExternal, revealAsset, type ShellLike } from "../assets/open";
import { getAsset } from "../db/assets-repo";

export interface HandlerDeps {
  db: () => Database.Database;
  clock: Clock;
  log: Logger;
  newId: () => string;
  startup: () => StartupOutcome;
  onFlushDone: () => void;
  undo: UndoStore;
  /** Visibility of the main view, for the alert engine (003 research §3). */
  alertSession: AlertSession;
  /** The alert settings, read fresh from the database on each call (003 FR-001). */
  alertSettings: () => AlertSettings;
  /** `app.isPackaged`: packaged builds never get the renderer test hook (004 research §8). */
  isPackaged: boolean;
  /** The data folder: stored files live in `<dataDir>/assets` (005). */
  dataDir: string;
  /** Electron's `shell` and `dialog`, injected so tests can stub them (005 FR-031, FR-027). */
  shell: ShellLike;
  dialog: {
    showOpenDialogSync(options: {
      properties: ("openFile" | "multiSelections")[];
      filters?: { name: string; extensions: string[] }[];
    }): string[] | undefined;
    /** 010 M1: the native confirmation naming the file before main reads a typed path (FR-001). */
    confirmImport(request: ConfirmRequest): Promise<boolean>;
  };
  platform: NodeJS.Platform;
  /** 016 FR-016: Electron's clipboard, injected so tests can stub it. */
  clipboard?: { write: (data: { text: string; html?: string }) => void };
  /** The background search index (006 research §4): whether it is complete, and a nudge after writes. */
  searchIndex?: { isPending: () => boolean; kick: () => void };
  /** 007: the theme source, the language watcher, the menu, capture forwarding and the window. */
  settings?: SettingsDeps;
  /** 009: `app.getVersion()`. */
  appVersion?: string;
  /** 009: the update check's current state (the scheduler, once started). */
  updateState?: () => UpdateState;
}

/** 009: what the renderer sees before the scheduler exists (contracts/ipc.md). */
export const IDLE_UPDATE_STATE: UpdateState = Object.freeze({
  checking: false,
  auto: true,
  result: { kind: "none" },
  mark: false,
  announce: null,
}) as UpdateState;

export interface SettingsDeps {
  isMac: boolean;
  nativeTheme: { themeSource: ThemeSetting };
  /** Hands the new setting to the LanguageWatcher and returns the active language (research §3). */
  setLanguageSetting: (setting: LanguageSetting) => Lang;
  /** Rebuilds the application menu in the active language with the current shortcuts (research §4, §10). */
  rebuildMenu: () => void;
  setCapture: (on: boolean) => void;
  minimizeWindow: () => void;
}

function settingsDeps(deps: HandlerDeps): SettingsDeps {
  if (deps.settings === undefined) throw new DomainError("INVALID", "settings are not available");
  return deps.settings;
}

export type Handler<C extends InvokeChannel> = (payload: Req<C>) => Res<C>;
export type Handlers = { [C in InvokeChannel]?: Handler<C> };

/** 016 FR-016b: opening, revealing and serving a stored file share one lookup and the folder guard. */
function openDeps(deps: HandlerDeps) {
  return {
    dir: deps.dataDir,
    shell: deps.shell,
    platform: deps.platform,
    find: (sha256: string) => {
      const row = getAsset(deps.db(), sha256);
      return row === null ? null : { ext: row.ext };
    },
    warn: (event: string) => {
      deps.log.warn(event, {});
    },
  };
}

/**
 * Saves a ChangeSet in one transaction with the history events it causes, and returns it as a Mutation (throws
 * SaveFailedError). The events are derived from the rows before and after (015 research §2, §4); `origin` says
 * which ones the writer may record. A change that already carries its events (an undo's removals) keeps them.
 */
export function commit(deps: HandlerDeps, changes: ChangeSet, origin: EventOrigin = "action", keepRedo = false): Mutation {
  const db = deps.db();
  const ids = changes.upserts.map((t) => t.id);
  const events =
    changes.events ??
    deriveEvents(loadByIds(db, ids), changes, { now: deps.clock.now(), newId: randomUUID, origin, lastEvents: lastEvents(db, ids), toleranceMin: deps.alertSettings().rescheduleToleranceMin });
  applyChangeSet(db, { ...changes, events });
  // 016 FR-006 (PRD Q256): any other change to the list ends a Redo offer; collapsing is not a change.
  if (!keepRedo) deps.undo.clearRedo();
  return withEvents(db, { upserts: changes.upserts, removals: changes.removals }, events);
}

/** Adds the written events, as stored (with their recording order), to a reply that has any (research §5). */
function withEvents<M extends Mutation>(db: Database.Database, mutation: M, events: EventWrite): M {
  if (events.inserts.length + events.updates.length + events.removals.length === 0) return mutation;
  const upserts = loadEventsById(db, [...events.inserts, ...events.updates].map((e) => e.id));
  return { ...mutation, events: { upserts, removals: events.removals } };
}

/** Saves an undoable action and stores the rows as they were, replacing any earlier undo (FR-028). */
function commitUndoable(
  deps: HandlerDeps,
  kind: UndoRecordKind,
  rows: readonly Task[],
  changes: ChangeSet,
): UndoableMutation {
  const before = beforeOf(rows, changes);
  const mutation = commit(deps, changes);
  // 015 FR-019 (PRD Q215): the undo removes the events this action recorded.
  const eventIds = mutation.events?.upserts.map((e) => e.id) ?? [];
  return { ...mutation, undoToken: deps.undo.put(kind, before, eventIds) };
}

/** Saves a ReminderChangeSet (rows and the section setting in one transaction) as a Mutation. */
export function commitReminders(deps: HandlerDeps, changes: ReminderChangeSet, keepRedo = false): Mutation {
  applyReminderChangeSet(deps.db(), changes, deps.clock.now());
  if (!keepRedo) deps.undo.clearRedo();
  const mutation: Mutation = {
    upserts: [],
    removals: [],
    reminders: { upserts: changes.upserts, removals: changes.removals },
  };
  if (changes.sectionCollapsed !== null) mutation.remindersCollapsed = changes.sectionCollapsed;
  return mutation;
}

/** Saves an undoable reminder action; its record replaces any earlier undo, task or reminder (FR-014). */
export function commitUndoableReminders(
  deps: HandlerDeps,
  kind: UndoRecordKind,
  rows: readonly Reminder[],
  changes: ReminderChangeSet,
): UndoableMutation {
  // The rows as they were before the action, the acted-on reminder first (as beforeOf does for tasks).
  const byId = new Map(rows.map((r) => [r.id, r]));
  const before = [...changes.upserts.map((r) => r.id), ...changes.removals].flatMap((id) => byId.get(id) ?? []);
  const mutation = commitReminders(deps, changes);
  return { ...mutation, undoToken: deps.undo.putReminder(kind, before) };
}

/**
 * One alert tick (003 research §1–§3). A failed save is logged and the rows are still returned for display,
 * but with no episodes, so nothing plays that was not recorded; the next tick retries (FR-044).
 */
export function alertTick(deps: HandlerDeps, visible: boolean): AlertTick {
  deps.alertSession.report(visible);
  const now = deps.clock.now();
  const tasks = loadAll(deps.db());
  const { upserts, episodes } = evaluateAlerts({
    tasks,
    settings: deps.alertSettings(),
    now,
    visibility: deps.alertSession.visibility(),
  });
  deps.log.trace("alerts.tick", { rows: upserts.length, episodes: episodes.length });
  // 015 FR-017, FR-018: a task going stale on its own records it, at the real moment, in the tick's transaction.
  const events = deriveEvents(tasks, { upserts, removals: [] }, { now, newId: randomUUID, origin: "tick", lastEvents: new Map(), toleranceMin: deps.alertSettings().rescheduleToleranceMin });
  try {
    applyChangeSet(deps.db(), { upserts, removals: [], events });
  } catch (err) {
    if (!(err instanceof SaveFailedError)) throw err;
    deps.log.error("alerts.tick-save-failed", { message: err.message });
    return { upserts, removals: [], episodes: [], now };
  }
  return withEvents(deps.db(), { upserts, removals: [], episodes, now }, events);
}

/** The 007 part of the initial state: stored settings, and the language main resolved (research §3). */
function uiState(deps: HandlerDeps) {
  const isMac = deps.settings?.isMac ?? deps.platform === "darwin";
  const { settings } = loadUiSettings(deps.db(), isMac);
  const language = deps.settings?.setLanguageSetting(settings.language) ?? (settings.language === "system" ? "en" : settings.language);
  return { theme: settings.theme, palette: settings.palette, languageSetting: settings.language, language, shortcuts: settings.shortcuts, isMac };
}

/** The 009 part of the initial state: the stored log level and update switch, the version, the update check. */
function logState(deps: HandlerDeps) {
  const { logLevel, autoUpdateCheck, updateReminder, updateReminderDays } = loadLogSettings(deps.db());
  return {
    logLevel,
    autoUpdateCheck,
    updateReminder,
    updateReminderDays,
    appVersion: deps.appVersion ?? "0.0.0",
    update: deps.updateState?.() ?? { ...IDLE_UPDATE_STATE, auto: autoUpdateCheck },
  };
}

/** The 011 part of the initial state: the color picker's lists (pinned as hex order) and the table size order. */
function editorState(deps: HandlerDeps) {
  const { pinnedColors, recentColors, tableRowsFirst, lastTextColor } = loadEditorSettings(deps.db());
  return { pinnedColors: pinnedColors.map((e) => e.hex), recentColors, tableRowsFirst, lastTextColor };
}

/** 017 FR-015a (PRD Q269): while newer data is refused, storing a file fails like any change, before any file is written. */
function refuseWhileNewerData(deps: HandlerDeps): void {
  if (deps.startup().kind === "newerData") throw new SaveFailedError("data saved by a newer version of Vesta is refused");
}

const assetStore = (deps: HandlerDeps) => {
  refuseWhileNewerData(deps);
  return { dir: deps.dataDir, db: deps.db(), clock: deps.clock };
};

export function buildHandlers(deps: HandlerDeps): Handlers {
  return {
    "app:get-initial-state": () => ({
      tasks: loadAll(deps.db()),
      reminders: loadReminders(deps.db()),
      remindersCollapsed: loadRemindersCollapsed(deps.db()),
      startup: deps.startup(),
      now: deps.clock.now(),
      alertSettings: deps.alertSettings(),
      testHooks: !deps.isPackaged,
      panelWidth: loadPanelWidth(deps.db()).px,
      ...uiState(deps),
      ...logState(deps),
      ...editorState(deps),
      // 018 FR-014, FR-020d: both cleanups, with the time left of an hour after a change.
      cleanup: cleanupViews(deps.db(), deps.clock.now()),
    }),
    // 007: one row per change, with updated_at for 008's merge (contracts/ipc.md).
    "settings:set-alert": ({ key, minutes }) => {
      const { min, max } = ALERT_LIMITS[key];
      if (minutes < min || minutes > max) throw new DomainError("INVALID", `${key} must be ${String(min)}–${String(max)} minutes`);
      // 012 FR-026: a new global period and the stale tasks it un-stales are saved together, or neither is.
      const db = deps.db();
      const now = deps.clock.now();
      let tasks: Task[] = [];
      db.transaction(() => {
        saveAlertSetting(db, key, minutes, now);
        if (key === "alertPeriodMin") {
          const all = loadAll(db);
          tasks = applyPeriodChange(all, loadAlertSettings(db).settings, now).upserts;
          // 015 Q216: each task the new period un-stales records "No longer stale", in this transaction.
          const events = deriveEvents(all, { upserts: tasks, removals: [] }, { now, newId: randomUUID, origin: "period", lastEvents: new Map(), toleranceMin: deps.alertSettings().rescheduleToleranceMin });
          applyChangeSet(db, { upserts: tasks, removals: [], events });
        }
      })();
      // 015 FR-013: Edit › Postpone For shows the durations, so a change of one rebuilds the menu bar.
      if ((QUICK_RESCHEDULE_KEYS as readonly string[]).includes(key)) deps.settings?.rebuildMenu();
      return { settings: loadAlertSettings(db).settings, tasks };
    },
    "settings:set-theme": ({ theme }) => {
      saveTheme(deps.db(), theme, deps.clock.now());
      settingsDeps(deps).nativeTheme.themeSource = theme;
      return null;
    },
    "settings:set-palette": ({ palette }) => {
      savePalette(deps.db(), palette, deps.clock.now());
      return null;
    },
    "settings:set-language": ({ setting }) => {
      const s = settingsDeps(deps);
      saveLanguage(deps.db(), setting, deps.clock.now());
      const language = s.setLanguageSetting(setting);
      s.rebuildMenu();
      return { language };
    },
    "settings:set-shortcuts": ({ overrides }) => {
      const s = settingsDeps(deps);
      // A stored map is always valid: refuse what normalization would change (contracts/ipc.md).
      const normalized = normalizeOverrides(overrides, s.isMac);
      if (normalized.issues.length > 0) throw new DomainError("INVALID", "the shortcut map is not valid");
      saveShortcuts(deps.db(), overrides, deps.clock.now());
      s.rebuildMenu();
      return null;
    },
    // 011 contracts/ipc.md: only the non-null lists are written; main stamps pin times.
    "settings:set-color-lists": ({ pinned, recent, pinnedNow }) => {
      saveColorLists(
        deps.db(),
        { ...(pinned === null ? {} : { pinned }), ...(recent === null ? {} : { recent }), ...(pinnedNow === null ? {} : { pinnedNow }) },
        deps.clock.now(),
      );
      return null;
    },
    "settings:set-table-rows-first": ({ on }) => {
      saveTableRowsFirst(deps.db(), on, deps.clock.now());
      return null;
    },
    "window:minimize": () => {
      settingsDeps(deps).minimizeWindow();
      return null;
    },
    "keys:set-capture": ({ on }) => {
      settingsDeps(deps).setCapture(on);
      return null;
    },
    "assets:import-bytes": (input) => importBytes(assetStore(deps), input),
    // The renderer never sees a path: refs and names only (contracts/ipc.md).
    "assets:pick": ({ scope }) => {
      refuseWhileNewerData(deps);
      const paths =
        deps.dialog.showOpenDialogSync({
          properties: ["openFile", "multiSelections"],
          ...(scope === "title"
            ? { filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] }
            : {}),
        }) ?? [];
      const refs: AssetRef[] = [];
      const refused: string[] = [];
      for (const path of paths) {
        try {
          refs.push(importPath(assetStore(deps), { path, scope }));
        } catch (err) {
          if (!(err instanceof AssetError)) throw err;
          deps.log.warn("asset.refused", { code: err.code, name: basename(path) });
          refused.push(basename(path));
        }
      }
      return { refs, refused };
    },
    "assets:open": ({ ref }) => {
      openAsset(ref, openDeps(deps));
      return null;
    },
    // 016 FR-016a (PRD Q241): Show in Finder, File Explorer or Folder.
    "assets:reveal": ({ ref }) => {
      revealAsset(ref, openDeps(deps));
      return null;
    },
    // 016 FR-016 (PRD Q234): Copy and Copy Link write the system clipboard here, the one place it is reliable.
    "clipboard:write": ({ text, html }) => {
      if (deps.clipboard === undefined) throw new DomainError("INVALID", "no clipboard");
      deps.clipboard.write(html === null ? { text } : { text, html });
      return null;
    },
    "app:open-external": ({ url }) => {
      openExternal(url, deps.shell);
      return null;
    },
    "search:query": (q) => runSearchQuery(deps.db(), q, deps.searchIndex?.isPending() ?? isIndexPending(deps.db()), deps.log),
    "settings:set-panel-width": ({ px }) => {
      savePanelWidth(deps.db(), px, deps.clock.now());
      return null;
    },
    "app:flush-done": () => {
      deps.onFlushDone();
      return null;
    },
    // FR-040: errors in the window are written to the same local log.
    "app:log-error": ({ message, stack, context }) => {
      deps.log.error("renderer.error", { context, message, stack });
      return null;
    },
    "tasks:create": (input) => commit(deps, create(input, loadAll(deps.db()), deps.clock, deps.newId)),
    "tasks:edit-title": ({ id, title }) => commit(deps, editTitle(id, title, loadAll(deps.db()), deps.clock)),
    // The panel shows its own save state; no undo record (005 contracts/ipc.md).
    "tasks:edit-details": ({ id, details }) => commit(deps, editDetails(id, details, loadAll(deps.db()), deps.clock)),
    "tasks:set-collapsed": ({ id, collapsed }) => commit(deps, setCollapsed(id, collapsed, loadAll(deps.db())), "action", true),
    "tasks:mark-done": ({ id }) => {
      const rows = loadAll(deps.db());
      return commitUndoable(deps, "done", rows, markDone(id, rows, deps.clock));
    },
    // 018 FR-009, FR-010 (contracts/ipc-cleanup.md): one channel for both deletes; the row's state picks the action.
    "tasks:delete": ({ id }) => {
      const rows = loadAll(deps.db());
      const row = rows.find((t) => t.id === id);
      if (row !== undefined && row.doneAt !== null && row.deletedAt === null)
        return commitUndoable(deps, "trashDone", rows, trashDone(id, rows, deps.clock));
      return commitUndoable(deps, "delete", rows, remove(id, rows, deps.clock));
    },
    "tasks:restore": ({ id }) => {
      const rows = loadAll(deps.db());
      return commitUndoable(deps, "restore", rows, restore(id, rows, deps.clock, deps.alertSettings()));
    },
    "tasks:delete-permanently": ({ id }) => commit(deps, deletePermanently(id, loadAll(deps.db()))),
    "reminders:create": ({ text }) =>
      commitReminders(deps, createReminder({ text }, loadReminders(deps.db()), deps.clock, deps.newId)),
    "reminders:edit-text": ({ id, text }) =>
      commitReminders(deps, editReminderText(id, text, loadReminders(deps.db()), deps.clock)),
    "reminders:mark-done": ({ id }) => {
      const rows = loadReminders(deps.db());
      return commitUndoableReminders(deps, "done", rows, markReminderDone(id, rows, deps.clock));
    },
    "reminders:set-collapsed": ({ collapsed }) =>
      commitReminders(deps, setRemindersCollapsed(collapsed, loadRemindersCollapsed(deps.db())), true),
    "reminders:restore": ({ id }) => {
      const rows = loadReminders(deps.db());
      const collapsed = loadRemindersCollapsed(deps.db());
      return commitUndoableReminders(deps, "restore", rows, restoreReminder(id, rows, collapsed, deps.clock));
    },
    "reminders:delete-permanently": ({ id }) =>
      commitReminders(deps, deleteReminderPermanently(id, loadReminders(deps.db()))),
    "reminders:delete": ({ id }) => {
      const rows = loadReminders(deps.db());
      const row = rows.find((r) => r.id === id);
      if (row !== undefined && row.doneAt !== null && row.deletedAt === null)
        return commitUndoableReminders(deps, "trashDone", rows, trashDoneReminder(id, rows, deps.clock));
      return commitUndoableReminders(deps, "delete", rows, removeReminder(id, rows, deps.clock));
    },
    "tasks:history": ({ id }) => loadHistory(deps.db(), id),
    "tasks:reschedule": ({ id, forMin }) => {
      const rows = loadAll(deps.db());
      return commitUndoable(deps, "reschedule", rows, reschedule(id, rows, deps.clock, deps.alertSettings(), forMin));
    },
    // 016 FR-022 (PRD Q230): the Text color swatch.
    "settings:set-last-text-color": ({ hex }) => {
      saveLastTextColor(deps.db(), hex, deps.clock.now());
      return null;
    },
    "tasks:set-alert-override": ({ id, minutes }) =>
      commit(deps, setAlertOverride(id, minutes, loadAll(deps.db()), deps.clock, deps.alertSettings())),
    "tasks:move": ({ id, dest }) =>
      commit(deps, moveTask(id, dest, loadAll(deps.db()), deps.clock, deps.alertSettings())),
    "reminders:move": ({ id, beforeId }) =>
      commitReminders(deps, moveReminder(id, beforeId, loadReminders(deps.db()), deps.clock)),
    "alerts:tick": ({ visible }) => alertTick(deps, visible),
    "undo:apply": ({ token }) => {
      const record = deps.undo.take(token);
      if (isReminderUndo(record))
        return commitReminders(deps, applyReminderUndo(record, loadReminders(deps.db()), deps.clock));
      const eventIds = record.eventIds ?? [];
      // 016 FR-004: the duration the reschedule recorded is what Redo applies again (research §1).
      const recorded = record.kind === "reschedule" ? loadEventsById(deps.db(), eventIds).find((e) => e.kind === "rescheduled") : undefined;
      const changes = applyUndo(record, loadAll(deps.db()), deps.clock);
      const mutation: UndoReply = commit(deps, { ...changes, events: { inserts: [], updates: [], removals: [...eventIds] } }, "undo");
      const taskId = record.before[0]?.id;
      if (record.kind === "reschedule" && taskId !== undefined && recorded?.detail != null && changes.upserts.length > 0) {
        mutation.redoToken = deps.undo.putRedo(taskId, recorded.detail);
      }
      return mutation;
    },
    "undo:redo": ({ token }) => {
      const { taskId, forMin } = deps.undo.takeRedo(token);
      const rows = loadAll(deps.db());
      return commitUndoable(deps, "reschedule", rows, reschedule(taskId, rows, deps.clock, deps.alertSettings(), forMin));
    },
  };
}

function idsOf(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const p = payload as Record<string, unknown>;
  return ["id", "parentId"].flatMap((k) => (typeof p[k] === "string" ? [p[k]] : []));
}

/** Pure dispatch, used by registerHandlers and by tests. */
export function dispatch<C extends InvokeChannel>(
  handlers: Handlers,
  deps: HandlerDeps,
  channel: C,
  payload: unknown,
): Result<Res<C>> {
  const checked = validatePayload(channel, payload);
  if (!checked.ok) {
    // 010 L1 (FR-009): the channel and the field, never the value.
    deps.log.warn("ipc.invalid", { channel, message: checked.message });
    return { ok: false, error: { code: "INVALID", message: checked.message } };
  }
  const handler: Handler<C> | undefined = handlers[channel];
  if (handler === undefined) return { ok: false, error: { code: "INVALID", message: `${channel} is not available` } };
  return toResult(channel, idsOf(payload), () => handler(checked.value), deps.log);
}

/** The size of a payload, without serializing it: strings by length, byte arrays by byteLength. */
export function payloadBytes(payload: unknown): number {
  if (typeof payload === "string") return payload.length;
  if (payload instanceof Uint8Array) return payload.byteLength;
  if (Array.isArray(payload)) return payload.reduce((n: number, v: unknown) => n + payloadBytes(v), 0);
  if (typeof payload === "object" && payload !== null) return Object.values(payload).reduce((n: number, v: unknown) => n + payloadBytes(v), 0);
  return payload === undefined ? 0 : 8;
}

/** Channels that change item text: tasks, reminders and undo (not reads, ticks, assets or settings). */
const WRITE_CHANNEL = /^(?:tasks|reminders|undo):/;
/** 008 FR-037b: channels that change an item or a setting end a pending Undo import offer first (not alerts:tick). */
const CHANGE_CHANNEL = /^(?:tasks|reminders|undo|settings):/;

/** 008: the export and import channels run asynchronously (research §8). */
export type AsyncHandlers = { [C in InvokeChannel]?: (payload: Req<C>) => Promise<Res<C>> };

export async function dispatchAsync<C extends InvokeChannel>(
  handlers: AsyncHandlers,
  deps: HandlerDeps,
  channel: C,
  payload: unknown,
): Promise<Result<Res<C>>> {
  const checked = validatePayload(channel, payload);
  if (!checked.ok) return { ok: false, error: { code: "INVALID", message: checked.message } };
  const handler = handlers[channel];
  if (handler === undefined) return { ok: false, error: { code: "INVALID", message: `${channel} is not available` } };
  try {
    return { ok: true, value: await handler(checked.value) };
  } catch (err) {
    return toResult(channel, [], () => {
      throw err;
    }, deps.log);
  }
}

export function registerHandlers(
  ipcMain: IpcMain,
  handlers: Handlers,
  deps: HandlerDeps,
  isTrusted: (frame: WebFrameMain | null | undefined) => boolean,
  asyncHandlers: AsyncHandlers = {},
  beforeWrite: () => void = () => undefined,
): void {
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event, payload: unknown) => {
      // 010 FR-019 (L4): the main window's main frame on the app origin, nothing else (security.ts).
      if (!isTrusted(event.senderFrame)) {
        // 009 FR-003: a file:// sender address could hold the user's home folder; scheme and host only.
        const url = event.senderFrame?.url ?? "";
        deps.log.warn("ipc.untrusted-sender", { channel, ...hostOnly(url) });
        return { ok: false, error: { code: "INVALID", message: "untrusted sender" } };
      }
      const t0 = performance.now();
      // 009 FR-003, research §4: Trace records the channel, its time and the payload's size, never the payload.
      const trace = (ok: boolean) => {
        deps.log.trace("ipc.call", { channel, ms: Math.round(performance.now() - t0), ok, bytes: payloadBytes(payload) });
      };
      if (asyncHandlers[channel] !== undefined) {
        return dispatchAsync(asyncHandlers, deps, channel, payload).then((result) => {
          trace(result.ok);
          return result;
        });
      }
      if (CHANGE_CHANNEL.test(channel)) beforeWrite();
      const result = dispatch(handlers, deps, channel, payload);
      trace(result.ok);
      // A write may have left large details pending: let the background fill look (006 research §4).
      if (result.ok && WRITE_CHANNEL.test(channel)) deps.searchIndex?.kick();
      return result;
    });
  }
}

/** 010 M1 (FR-001 to FR-003): the typed-path import, asynchronous because it waits for the user's confirmation. */
export function buildAssetAsyncHandlers(deps: HandlerDeps): AsyncHandlers {
  return {
    "assets:import-path": async (input) => {
      try {
        const resolved = resolveForImport(deps.dataDir, input);
        return await importConfirmed(assetStore(deps), resolved, input.scope, (request) => deps.dialog.confirmImport(request));
      } catch (err) {
        // The name only, never the path (009 FR-003).
        if (err instanceof AssetError) {
          if (err.code === "CANCELLED") deps.log.info("asset.cancelled", { name: basename(input.path) });
          else deps.log.warn("asset.refused", { code: err.code, name: basename(input.path) });
        }
        throw err;
      }
    },
  };
}

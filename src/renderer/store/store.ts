/**
 * Renderer state. Rows change only from a main-process reply, so a failed save leaves the list at the
 * last saved state (FR-040, research.md §3).
 */
import { create } from "zustand";
import { setMac } from "../platform";
import { fitsView } from "./panel-view";
import {
  initialNotifications,
  reduce,
  visibleImportUndoToken,
  visibleRedoToken,
  visibleUndoToken,
  type NotificationEvent,
  type NotificationState,
  type UndoKind,
} from "../../domain/notifications";
import type { Reminder } from "../../domain/reminder";
import type { StartupOutcome } from "../../domain/startup-outcome";
import { isActive, type Task } from "../../domain/task";
import type { TaskEvent } from "../../domain/task-events";
import { PANEL_DEFAULT_PX, clampPanelWidth } from "../../domain/panel-width";
import {
  DEFAULT_ALERT_SETTINGS,
  type AlertSettingKey,
  type AlertSettings,
} from "../../domain/alert-settings";
import type { Lang, LanguageSetting } from "../../domain/language";
import {
  DEFAULT_PALETTE,
  type PaletteSetting,
  type ThemeSetting,
} from "../../domain/settings";
import { applyPalette } from "../theme";
import { paintAll } from "../markdown/paint";
import type { LogLevel } from "../../domain/logs/levels";
import type { ActionId } from "../../domain/shortcuts/actions";
import type { ShortcutOverrides } from "../../domain/shortcuts/map";
import { setLanguage, t } from "../i18n/t";
import type { MoveDest } from "../../domain/move";
import type {
  AlertTick,
  DataSnapshot,
  ImportRefusal,
  Mutation,
  Result,
  SearchResult,
  UndoableMutation,
  UpdateState,
} from "../../shared/ipc-contract";
import { planReplace } from "./replace-data";
import { planReminder, planUpdateNotice } from "./update-state";
import { rendererClock } from "../clock";
import { afterPointerRelease } from "../pointer";
import {
  applyReply,
  checkSlow,
  endSearch,
  initialSession,
  onEdit,
  onQueryChange,
  send,
  SLOW_MS,
  type SearchSession,
} from "../../domain/search/session";
import { isActive as isSearchActive } from "../../domain/search/query";
import { reportError } from "../report";
import { plain } from "../markdown/plain";

export type View = "tasks" | "archive" | "trash";
/** The Settings panes, in toolbar order (HIG identity: Settings laid out as a settings window). */
/** 013 FR-025 (PRD Q168): About is a window of its own, not a pane. */
export type SettingsPane =
  "general" | "alerts" | "shortcuts" | "data" | "updates";

/** What is being edited inline: a task id, the end-of-list empty card, or a parent's subtask card. */
export type EditingKey = string;

/** 016 FR-016 (ui.md "Link context menu"): a right-click on a safe link. `href` is the stored address. */
export interface LinkMenuTarget {
  x: number;
  y: number;
  href: string;
  text: string;
  back: HTMLElement | null;
}
export const NEW_TASK: EditingKey = "new:task";
export const newSubKey = (parentId: string): EditingKey =>
  `new:sub:${parentId}`;
export const NEW_REMINDER: EditingKey = "new:rem";

/** The shown task order at drag start: top-level ids with their shown subtask ids (004 FR-012). */
export interface FrozenNode {
  id: string;
  subs: string[];
}

export interface DragState {
  id: string;
  kind: "task" | "rem";
  /** Task drags only: the list keeps this order until the drag ends. */
  frozen: FrozenNode[] | null;
}

/** The indicator as drawn: a line at an indent, a card outline or the stale group's outline (004 FR-012). */
export interface DropBox {
  kind: "line-top" | "line-sub" | "card" | "group";
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface VestaState {
  ready: boolean;
  tasks: Readonly<Record<string, Task>>;
  reminders: Readonly<Record<string, Reminder>>;
  remindersCollapsed: boolean;
  view: View;
  editingKey: EditingKey | null;
  menuFor: string | null;
  notifications: NotificationState;
  startup: StartupOutcome | null;
  /** Main's time from the last alert tick; drives every age label (003 FR-012). */
  now: number;
  alertSettings: AlertSettings;
  /** 015 research §5: the history events of the tasks whose panel has shown them, kept current from every reply. */
  history: Readonly<Record<string, readonly TaskEvent[]>>;
  /** Blink episodes playing now, by task id (003 FR-016 to FR-021a). */
  episodes: Readonly<Record<string, { blinks: 1 | 3; startedAt: number }>>;
  /** The task whose Alert override panel is open (003 FR-034). */
  overrideFor: string | null;
  /** The item being dragged: drives dimming and the frozen order (004 FR-002, FR-012). */
  drag: DragState | null;
  /** What DropOverlay draws, in `.main-inner` coordinates (004 FR-012). */
  dropIndicator: DropBox | null;
  /** Dragging and keyboard moves are off (004 FR-029); search (006) will drive it. */
  movingDisabled: boolean;
  /** The control to refocus once a moved card renders (004 FR-024). */
  focusAfterMove: { id: string; ctl: string } | null;
  /** Polite live-region text after a move; `seq` makes a repeated text announce again (004 FR-027). */
  announcement: { text: string; seq: number } | null;
  /** Unpackaged builds: window.__vestaTest is defined (004 research §8). */
  testHooks: boolean;
  /** The task shown in the details panel (005 FR-001 to FR-004). */
  panelFor: string | null;
  /** Drives "Saved" and "Changes not saved" (005 FR-010). */
  panelSave: PanelSaveView;
  /** The panel's width in px (005 FR-005). */
  panelWidth: number;
  /** A refused file: "“{name}” is larger than 100 MB and was not added." and the like (005 FR-028, FR-029). */
  assetNotice: { text: string } | null;
  /** 016 FR-016: the link context menu, at the pointer; `back` gets the focus again when it closes. */
  linkMenu: LinkMenuTarget | null;
  /** 016 FR-016c (Q257): the "will not be opened" line at an unsafe link in a read-only place. */
  unsafeLinkPop: { left: number; top: number; back: HTMLElement } | null;
  /** The search box and its results (006 data-model "Transient renderer state"); never persisted (FR-024). */
  search: SearchState;
  /** 007 (data-model "Transient renderer state"): the active language; components re-render on change. */
  language: Lang;
  languageSetting: LanguageSetting;
  theme: ThemeSetting;
  /** HIG identity: the color theme (palette); colors only. */
  palette: PaletteSetting;
  /** Stored overrides; `effectiveMap` derives the live map. */
  shortcuts: ShortcutOverrides;
  /** The shortcut defaults and notation depend on the platform (research §9). */
  isMac: boolean;
  /** The Settings dialog is open: selection and global actions are off (FR-022). */
  settingsOpen: boolean;
  /** The card id (or "cog") to focus when Settings closes (research §8). */
  settingsReturnFocus: string | null;
  /** The shortcut being captured (FR-033, FR-035); the double-Esc state lives in ShortcutTable. */
  capture: { action: ActionId } | null;
  /** 008 data-model "Renderer state": the running export, import or undo; disables both buttons (FR-003). */
  dataOp: "idle" | "exporting" | "importing" | "undoing";
  /** The last outcome shown in the Settings section, kept until the next operation. */
  dataMessage: DataMessage | null;
  /** 008 FR-015: the Data pane's "include logs" choice, unticked each time Settings opens; File › Export… uses it too (013 FR-003). */
  includeLogs: boolean;
  /** Mirrors the importUndo notice: the token, and its deadline on the renderer clock (FR-037b). */
  undoOffer: { token: string; deadline: number } | null;
  /** 009: the stored log level (viewer filter and recording floor) and the automatic update check. */
  logLevel: LogLevel;
  autoUpdateCheck: boolean;
  /** 010 Q133: the update reminder while automatic checks are off. */
  updateReminder: boolean;
  updateReminderDays: number;
  /** 011 FR-016: the color picker's pinned (hex order) and recent colors, and the order of table sizes. */
  pinnedColors: string[];
  recentColors: string[];
  tableRowsFirst: boolean;
  /** 016 FR-019: the Text color swatch (Hex8), the Hearth ember until a text color is picked. */
  lastTextColor: string;
  /**
   * 018 FR-014, FR-020d: each cleanup's switch and time, and the end of its hour after a change on the renderer clock
   * (null: none), for the countdown.
   */
  cleanup: Record<"archive" | "trash", CleanupUi>;
  /** 009: the running version, for About and the update messages. */
  appVersion: string;
  /** 009: the update check as main reports it (contracts/ipc.md). */
  update: UpdateState;
  /** 009: the version whose update notice was already queued this session. */
  updateQueued: string | null;
  /** 010 FR-033: a reminder came due while Settings was open; it shows when Settings closes. */
  reminderQueued: boolean;
  /** 009: the log viewer dialog is open over Settings. */
  logViewerOpen: boolean;
  /** 009: Settings was opened from the update notice: scroll to Updates. */
  settingsSection: "updates" | "logs" | null;
  /** HIG identity: the pane Settings shows; kept across closes, so the last pane opens next time (HIG Settings). */
  settingsPane: SettingsPane;
  /** 013 FR-027 to FR-031, 015 FR-028 to FR-030: the About window, and which of its views it shows (PRD Q205, Q213). */
  aboutOpen: boolean;
  aboutView: AboutView;
}

/** 015 research §11: About, or the license view that replaced it. */
export type AboutView = "about" | "license" | "thirdParty";

/** 008: an outcome shown in Settings (a merged import shows as a notification instead, PRD Q121). */
export type DataMessage =
  | {
      kind: "exportWritten";
      fileName: string;
      folder: string;
      skippedFiles: number;
    }
  | { kind: "exportFailed" }
  | { kind: "refused"; refusal: ImportRefusal }
  | { kind: "notStarted" }
  | { kind: "failedRestored" }
  /** 017 FR-015a (PRD Q269): export or import refused while data saved by a newer version is refused. */
  | { kind: "dataRefused" };

export interface SearchState {
  text: string;
  matchCase: boolean;
  exactPhrase: boolean;
  includeArchiveTrash: boolean;
  /** text.trim() is not empty (FR-002). */
  active: boolean;
  session: SearchSession;
}

const initialSearch = (): SearchState => ({
  text: "",
  matchCase: false,
  exactPhrase: false,
  includeArchiveTrash: false,
  active: false,
  session: initialSession(),
});

export type PanelSaveView = {
  state: "idle" | "pending" | "saving" | "saved" | "failed";
  failedSticky: boolean;
};

export const useVesta = create<VestaState>(() => ({
  ready: false,
  tasks: {},
  reminders: {},
  remindersCollapsed: false,
  view: "tasks",
  editingKey: null,
  menuFor: null,
  notifications: initialNotifications,
  startup: null,
  now: 0,
  alertSettings: { ...DEFAULT_ALERT_SETTINGS },
  episodes: {},
  history: {},
  overrideFor: null,
  drag: null,
  dropIndicator: null,
  movingDisabled: false,
  focusAfterMove: null,
  announcement: null,
  testHooks: false,
  panelFor: null,
  panelSave: { state: "idle", failedSticky: false },
  panelWidth: PANEL_DEFAULT_PX,
  assetNotice: null,
  linkMenu: null,
  unsafeLinkPop: null,
  search: initialSearch(),
  language: "en",
  languageSetting: "system",
  theme: "system",
  palette: DEFAULT_PALETTE,
  shortcuts: {},
  isMac: navigator.userAgent.includes("Mac"),
  settingsOpen: false,
  settingsReturnFocus: null,
  capture: null,
  dataOp: "idle",
  dataMessage: null,
  includeLogs: false,
  undoOffer: null,
  logLevel: "info",
  autoUpdateCheck: true,
  updateReminder: true,
  updateReminderDays: 30,
  pinnedColors: [],
  recentColors: [],
  tableRowsFirst: false,
  lastTextColor: "#b9411cff",
  cleanup: { archive: { on: true, hours: 87_600, deadline: null }, trash: { on: true, hours: 720, deadline: null } },
  appVersion: "",
  update: {
    checking: false,
    auto: true,
    result: { kind: "none" },
    mark: false,
    announce: null,
  },
  updateQueued: null,
  reminderQueued: false,
  logViewerOpen: false,
  aboutOpen: false,
  aboutView: "about",
  settingsSection: null,
  settingsPane: "general",
}));

const set = useVesta.setState;
const get = useVesta.getState;

/** Asks the alert driver for a tick; set by the driver when it starts (003 FR-010). */
/** 016 FR-016c: the unsafe link a title or reminder edit opens on (`editUnsafeLink`). */
let unsafeLinkPending: number | null = null;
let tickRequester: () => void = () => undefined;
export function setTickRequester(fn: () => void): void {
  tickRequester = fn;
}
/** Runs a call, then asks for an alert tick once its reply is merged. */
async function thenTick<T>(p: Promise<T>): Promise<T> {
  const value = await p;
  tickRequester();
  return value;
}

export function notify(event: NotificationEvent): void {
  set((s) => ({
    notifications: reduce(s.notifications, event, rendererClock.now()),
  }));
  // 008 FR-037b: once the importUndo notice is gone (closed, replaced or expired), the offer ends.
  const offer = get().undoOffer;
  if (
    offer !== null &&
    get().dataOp !== "undoing" &&
    visibleImportUndoToken(get().notifications) !== offer.token
  )
    endUndoOffer();
}

/** Ends a pending Undo import offer in main and removes its notice (008 FR-037b; analysis U4). */
function endUndoOffer(): void {
  if (get().undoOffer === null) return;
  set({ undoOffer: null });
  // Announced once, not each second (analysis A1); an undo announces its own result instead.
  if (get().dataOp !== "undoing") actions.announce(t("undoImportEnded"));
  if (visibleImportUndoToken(get().notifications) !== null)
    set((s) => ({
      notifications: reduce(
        s.notifications,
        { type: "close" },
        rendererClock.now(),
      ),
    }));
  void window.vesta.data.endUndoOffer().catch((err: unknown) => {
    reportError("store.endUndoOffer", err);
  });
}

/** One update with the imported (or restored) data; then the language, the search and an alert tick (FR-040). */
/** 018: a cleanup as the store keeps it: main's time left turned into a deadline on the renderer clock. */
export interface CleanupUi {
  on: boolean;
  hours: number;
  deadline: number | null;
}
const deadlineOf = (remainingMs: number | null): number | null => (remainingMs === null ? null : rendererClock.now() + remainingMs);
function cleanupUi(views: DataSnapshot["cleanup"]): Record<"archive" | "trash", CleanupUi> {
  return {
    archive: { on: views.archive.on, hours: views.archive.hours, deadline: deadlineOf(views.archive.remainingMs) },
    trash: { on: views.trash.on, hours: views.trash.hours, deadline: deadlineOf(views.trash.remainingMs) },
  };
}

function replaceData(snap: DataSnapshot): void {
  const s = get();
  const {
    patch,
    language,
    requery: again,
  } = planReplace(
    {
      panelFor: s.panelFor,
      view: s.view,
      overrideFor: s.overrideFor,
      editingKey: s.editingKey,
      menuFor: s.menuFor,
      searchActive: s.search.active,
    },
    snap,
  );
  set({ ...patch, cleanup: cleanupUi(snap.cleanup) });
  actions.applyLanguage(language);
  actions.applyPalette(patch.palette);
  if (again) requery();
  tickRequester();
}

function merge(m: Mutation): void {
  set((s) => {
    const tasks = { ...s.tasks };
    for (const row of m.upserts) tasks[row.id] = row;
    for (const id of m.removals) Reflect.deleteProperty(tasks, id);
    const reminders =
      m.reminders === undefined ? s.reminders : { ...s.reminders };
    if (m.reminders !== undefined) {
      for (const row of m.reminders.upserts)
        (reminders as Record<string, Reminder>)[row.id] = row;
      for (const id of m.reminders.removals)
        Reflect.deleteProperty(reminders, id);
    }
    // The Alert override panel closes for good when its task leaves the active list (003 FR-034 edge case).
    const target = s.overrideFor === null ? undefined : tasks[s.overrideFor];
    const overrideFor =
      target !== undefined && isActive(target) ? s.overrideFor : null;
    // The details panel closes when its item leaves the view it was opened in (005 FR-004, 011 FR-022b).
    const shown = s.panelFor === null ? undefined : tasks[s.panelFor];
    const panelFor =
      shown !== undefined && fitsView(shown, s.view) ? s.panelFor : null;
    return {
      tasks,
      reminders,
      remindersCollapsed: m.remindersCollapsed ?? s.remindersCollapsed,
      overrideFor,
      panelFor,
      history: mergeHistory(s.history, m),
    };
  });
}

/**
 * 015 research §5: a reply's events update the loaded histories (an insert, a merged override, an undo's removals);
 * a task deleted for good drops its history.
 */
function mergeHistory(
  history: Readonly<Record<string, readonly TaskEvent[]>>,
  m: Mutation,
): Readonly<Record<string, readonly TaskEvent[]>> {
  if (m.events === undefined && m.removals.length === 0) return history;
  const next: Record<string, readonly TaskEvent[]> = { ...history };
  for (const id of m.removals) Reflect.deleteProperty(next, id);
  const gone = new Set(m.events?.removals ?? []);
  if (gone.size > 0)
    for (const [id, list] of Object.entries(next))
      next[id] = list.filter((e) => !gone.has(e.id));
  for (const e of m.events?.upserts ?? []) {
    const list = next[e.taskId];
    if (list === undefined) continue;
    next[e.taskId] = list.some((x) => x.id === e.id)
      ? list.map((x) => (x.id === e.id ? e : x))
      : [...list, e];
  }
  return next;
}

/** Runs one IPC call; merges its rows on success. On SAVE_FAILED shows the sticky notice and changes nothing. */
export async function run<T extends Mutation>(
  call: () => Promise<Result<T>>,
  options: { quietInvalid?: boolean; listAction?: boolean } = {},
): Promise<T | null> {
  let result: Result<T>;
  try {
    result = await call();
  } catch (err) {
    reportError("store.run", err);
    notify({ type: "showSticky", kind: "saveFailed" });
    return null;
  }
  if (result.ok) {
    merge(result.value);
    requery();
    // 016 FR-006 (PRD Q256): any change to the list but a collapse ends a Redo offer.
    if (options.listAction !== false) notify({ type: "listAction" });
    return result.value;
  }
  // 010 L1 (FR-009): a value main refuses (INVALID, for example over a length limit) is a failed save too, except
  // where the caller says the call was no edit (an undo token yields no result and no message; convergence T093).
  if (
    result.error.code === "SAVE_FAILED" ||
    (result.error.code === "INVALID" && options.quietInvalid !== true)
  )
    notify({ type: "showSticky", kind: "saveFailed" });
  if (result.error.code !== "SAVE_FAILED")
    reportError(`store.run ${result.error.code}`, result.error.message);
  return null;
}

/** The item's text as the outcome banner names it (identity §9: "“Fix bike” moved to the Archive."). */
function itemTitle(id: string): string {
  const s = get();
  const md = s.tasks[id]?.titleMd ?? s.reminders[id]?.textMd ?? "";
  return plain(md).trim();
}

async function runUndoable(
  kind: UndoKind,
  id: string,
  call: () => Promise<Result<UndoableMutation>>,
): Promise<void> {
  const title = itemTitle(id);
  const value = await run(call);
  if (value !== null)
    notify({ type: "showUndo", kind, token: value.undoToken, title });
}

/**
 * One 007 settings call: true when saved. A failed save shows "Changes are not saved" and leaves the store,
 * so the control shows the saved value again (FR-039).
 */
async function settingCall<T>(
  call: () => Promise<Result<T>>,
): Promise<{ value: T } | null> {
  let result: Result<T>;
  try {
    result = await call();
  } catch (err) {
    reportError("store.setting", err);
    notify({ type: "showSticky", kind: "saveFailed" });
    return null;
  }
  if (result.ok) return { value: result.value };
  if (result.error.code === "SAVE_FAILED" || result.error.code === "INVALID")
    notify({ type: "showSticky", kind: "saveFailed" });
  if (result.error.code !== "SAVE_FAILED")
    reportError(`store.setting ${result.error.code}`, result.error.message);
  return null;
}

/** Startup outcome → sticky notices (FR-038a, FR-042, FR-042a). A first run shows nothing. */
function announceStartup(startup: StartupOutcome): void {
  if (startup.kind === "restored")
    notify({
      type: "showSticky",
      kind: "backupRestored",
      backupAt: startup.backupAt,
      moved: startup.moved,
    });
  if (startup.kind === "unrecoverable")
    notify({
      type: "showSticky",
      kind: "unrecoverable",
      damagedPath: startup.damagedPath,
    });
  // 017 FR-015a (PRD Q263): the data was saved by a newer version of Vesta and is refused.
  if (startup.kind === "newerData") notify({ type: "showSticky", kind: "newerData" });
  if (startup.folderNotWritable)
    notify({
      type: "showSticky",
      kind: "folderNotWritable",
      path: startup.dataDir,
    });
  // 010 FR-026 (L16): the previous run ended with an uncaught exception; a restore notice above takes precedence.
  if (startup.abnormalExitAt !== null)
    notify({
      type: "showSticky",
      kind: "abnormalExit",
      at: startup.abnormalExitAt,
    });
}

function setSession(fn: (session: SearchSession) => SearchSession): void {
  set((s) => ({ search: { ...s.search, session: fn(s.search.session) } }));
}

/** Items created or edited during a search stay shown (FR-009). */
function pin<T extends Mutation>(value: T | null): T | null {
  if (value !== null && get().search.active) {
    for (const row of [...value.upserts, ...(value.reminders?.upserts ?? [])])
      setSession((sess) => onEdit(sess, row.id, true));
  }
  return value;
}

/** Sends the current query; only the reply to the latest request applies (006 research §6). */
async function runSearch(): Promise<void> {
  const { search } = get();
  if (!search.active) return;
  const sent = send(search.session, rendererClock.now());
  setSession(() => sent.state);
  document.documentElement.dataset["searchSent"] = String(sent.seq);
  setTimeout(() => {
    setSession((sess) => checkSlow(sess, rendererClock.now()));
  }, SLOW_MS);
  let result: Result<SearchResult>;
  try {
    result = await window.vesta.search.query({
      seq: sent.seq,
      text: search.text,
      matchCase: search.matchCase,
      exactPhrase: search.exactPhrase,
      includeArchiveTrash: search.includeArchiveTrash,
    });
  } catch (err) {
    reportError("store.search", err);
    return;
  }
  if (!result.ok) {
    reportError(`store.search ${result.error.code}`, result.error.message);
    return;
  }
  const reply = result.value;
  setSession((sess) => applyReply(sess, reply));
  if (reply.seq === get().search.session.seq) {
    // Lets end-to-end tests wait for results, like 003's alertTicks (contracts/ipc.md).
    const root = document.documentElement;
    root.dataset["searchSeq"] = String(reply.seq);
    root.dataset["searchPending"] = String(reply.pending);
  }
}

/** Re-runs the current search after a change to the rows (FR-019, FR-025); not after alert ticks. */
function requery(): void {
  if (get().search.active) void runSearch();
}

/** A text or toggle change: items kept in view are released (FR-004c), then the search runs. */
function queryChanged(patch: Partial<SearchState>): void {
  set((s) => {
    const next = { ...s.search, ...patch };
    const active = isSearchActive(next.text);
    return {
      search: {
        ...next,
        active,
        session: active ? onQueryChange(next.session) : endSearch(next.session),
      },
    };
  });
  void runSearch();
}

export const actions = {
  async loadInitial(): Promise<void> {
    const result = await window.vesta.app.getInitialState();
    if (!result.ok) {
      reportError("store.loadInitial", result.error.message);
      return;
    }
    const tasks: Record<string, Task> = {};
    for (const row of result.value.tasks) tasks[row.id] = row;
    const reminders: Record<string, Reminder> = {};
    for (const row of result.value.reminders) reminders[row.id] = row;
    setMac(result.value.isMac);
    set({
      tasks,
      reminders,
      remindersCollapsed: result.value.remindersCollapsed,
      startup: result.value.startup,
      now: result.value.now,
      alertSettings: result.value.alertSettings,
      testHooks: result.value.testHooks,
      panelWidth: result.value.panelWidth,
      languageSetting: result.value.languageSetting,
      theme: result.value.theme,
      palette: result.value.palette,
      shortcuts: result.value.shortcuts,
      isMac: result.value.isMac,
      logLevel: result.value.logLevel,
      autoUpdateCheck: result.value.autoUpdateCheck,
      updateReminder: result.value.updateReminder,
      updateReminderDays: result.value.updateReminderDays,
      pinnedColors: result.value.pinnedColors,
      recentColors: result.value.recentColors,
      tableRowsFirst: result.value.tableRowsFirst,
      lastTextColor: result.value.lastTextColor,
      cleanup: cleanupUi(result.value.cleanup),
      appVersion: result.value.appVersion,
    });
    actions.applyUpdateState(result.value.update);
    actions.applyLanguage(result.value.language);
    applyPalette(result.value.palette);
    set({ ready: true });
    announceStartup(result.value.startup);
  },
  /** Every later t() and the language declared to assistive technology switch, then the views re-render (FR-017). */
  applyLanguage(language: Lang): void {
    setLanguage(language);
    document.documentElement.lang = language;
    set({ language });
  },
  /** Applied at once and re-evaluated by a tick (FR-004, FR-007); true when saved. */
  async setAlertSetting(
    key: AlertSettingKey,
    minutes: number,
  ): Promise<boolean> {
    const reply = await settingCall(() =>
      window.vesta.settings.setAlert({ key, minutes }),
    );
    if (reply === null) return false;
    set({ alertSettings: reply.value.settings });
    // 012 FR-026: the tasks the new period un-staled, merged like a tick's rows.
    if (reply.value.tasks.length > 0)
      merge({ upserts: reply.value.tasks, removals: [] });
    // 015 Q216: the period change may have written "No longer stale" for the open panel's task.
    const open = get().panelFor;
    if (key === "alertPeriodMin" && open !== null)
      void actions.loadHistory(open);
    tickRequester();
    return true;
  },
  /** Main sets nativeTheme before replying, so the colors follow at once (FR-010). */
  async setTheme(theme: ThemeSetting): Promise<boolean> {
    if (
      (await settingCall(() => window.vesta.settings.setTheme({ theme }))) ===
      null
    )
      return false;
    set({ theme });
    return true;
  },
  /** HIG identity: the palette applies at once and the colored spans are repainted for its surfaces (011 FR-009). */
  async setPalette(palette: PaletteSetting): Promise<boolean> {
    if (
      (await settingCall(() =>
        window.vesta.settings.setPalette({ palette }),
      )) === null
    )
      return false;
    set({ palette });
    actions.applyPalette(palette);
    return true;
  },
  applyPalette(palette: PaletteSetting): void {
    applyPalette(palette);
    if (typeof document !== "undefined") paintAll(document.body);
  },
  async setLanguageSetting(setting: LanguageSetting): Promise<boolean> {
    const reply = await settingCall(() =>
      window.vesta.settings.setLanguage({ setting }),
    );
    if (reply === null) return false;
    set({ languageSetting: setting });
    actions.applyLanguage(reply.value.language);
    return true;
  },
  async setShortcuts(shortcuts: ShortcutOverrides): Promise<boolean> {
    if (
      (await settingCall(() =>
        window.vesta.settings.setShortcuts({ overrides: shortcuts }),
      )) === null
    )
      return false;
    set({ shortcuts });
    return true;
  },
  openSettings(
    returnFocus: string | null,
    section: "updates" | "logs" | null = null,
  ): void {
    // A notice opens its own pane (Updates, or Data for the logs); otherwise the last pane shown.
    const pane: SettingsPane | null =
      section === "updates" ? "updates" : section === "logs" ? "data" : null;
    set({
      settingsOpen: true,
      settingsReturnFocus: returnFocus,
      menuFor: null,
      overrideFor: null,
      settingsSection: section,
      includeLogs: false,
      ...(pane === null ? {} : { settingsPane: pane }),
    });
    // 009 FR-024a: opening Settings drops a waiting update notice; 013 FR-024 (PRD Q176): the mark goes only
    // when the Updates pane is shown (SettingsDialog calls updatesPaneShown).
    notify({ type: "dropUpdate" });
  },
  /** 013 FR-024 (PRD Q176, T114): the Updates pane appeared (the mark and the Dock badge go) or went. */
  updatesPaneShown(shown = true): void {
    void window.vesta.updates
      .paneShown({ shown })
      .then((r) => {
        if (r.ok) set({ update: r.value });
      })
      .catch((err: unknown) => {
        reportError("store.updatesPaneShown", err);
      });
  },
  /** 013 FR-027: About Vesta opens its window; a second command brings the open one to the front (FR-019). */
  openAbout(): void {
    set({
      aboutOpen: true,
      aboutView: "about",
      menuFor: null,
      overrideFor: null,
    });
  },
  closeAbout(): void {
    set({ aboutOpen: false, aboutView: "about" });
  },
  /** 015 FR-029, FR-029a: License or Third-Party Licenses replaces About in the same window. */
  showLicense(view: "license" | "thirdParty"): void {
    set({ aboutView: view });
  },
  /** 015 FR-030: closing a license view shows About again. */
  closeLicense(): void {
    set({ aboutView: "about" });
  },
  setIncludeLogs(on: boolean): void {
    set({ includeLogs: on });
  },
  setSettingsPane(pane: SettingsPane): void {
    set({ settingsPane: pane });
  },
  closeSettings(): void {
    // 008 FR-003, PRD Q121: Settings cannot close while an import runs.
    if (get().dataOp === "importing") return;
    set({
      settingsOpen: false,
      capture: null,
      logViewerOpen: false,
      settingsSection: null,
    });
    // 010 FR-033 (Q133): a reminder that came due while Settings was open shows now.
    const reminder = planReminder("settingsClosed", {
      settingsOpen: false,
      queued: get().reminderQueued,
    });
    set({ reminderQueued: reminder.queued });
    if (reminder.show) notify({ type: "showReminder" });
  },
  /** 009: main's update state; an announcement becomes one notice per version (FR-024). */
  applyUpdateState(update: UpdateState): void {
    // 010 FR-033 (Q133): a completed check restarts the reminder period, so a waiting reminder is dropped.
    const previous = get().update.result;
    const previousAt = previous.kind === "none" ? null : previous.checkedAt;
    if (
      update.result.kind !== "none" &&
      update.result.kind !== "failed" &&
      update.result.checkedAt !== previousAt
    ) {
      notify({ type: "dropReminder" });
      set({
        reminderQueued: planReminder("checked", {
          settingsOpen: get().settingsOpen,
          queued: get().reminderQueued,
        }).queued,
      });
    }
    const plan = planUpdateNotice(
      update,
      get().updateQueued,
      get().settingsOpen,
    );
    set({ update, updateQueued: plan.queued, autoUpdateCheck: update.auto });
    if (plan.notify !== null)
      notify({ type: "showUpdate", version: plan.notify });
    // 013 Edge Cases: found while the Updates pane is shown, the user sees it there, so it counts as seen.
    if (get().settingsOpen && get().settingsPane === "updates" && update.mark)
      actions.updatesPaneShown();
  },
  /** 009 FR-024: the notice's View opens Settings at the Updates section (also the 010 reminder, FR-033). */
  openUpdatesFromNotice(): void {
    notify({ type: "close" });
    actions.openSettings("cog", "updates");
  },
  /** 010 FR-026 (L16): the abnormal-exit notice's "logs" link opens Settings at the Logs section. */
  openLogsFromNotice(): void {
    notify({ type: "close" });
    actions.openSettings("cog", "logs");
  },
  /** 009 FR-017: stored, applied to recording at once; the viewer reloads at the new level. */
  async setLogLevel(level: LogLevel): Promise<boolean> {
    if (
      (await settingCall(() =>
        window.vesta.settings.setLogLevel({ level }),
      )) === null
    )
      return false;
    set({ logLevel: level });
    return true;
  },
  /** 009 FR-021a. */
  async setAutoUpdateCheck(on: boolean): Promise<boolean> {
    const reply = await settingCall(() =>
      window.vesta.settings.setAutoUpdateCheck({ on }),
    );
    if (reply === null) return false;
    actions.applyUpdateState(reply.value);
    return true;
  },
  /** 010 Q133 (FR-034): the reminder switch and period, shown only while automatic checks are off. */
  async setUpdateReminder(on: boolean): Promise<boolean> {
    if (
      (await settingCall(() =>
        window.vesta.settings.setUpdateReminder({ on }),
      )) === null
    )
      return false;
    set({ updateReminder: on });
    return true;
  },
  /**
   * 018 FR-020a to FR-020d (contracts/ipc-cleanup.md): a cleanup change; `commit` false is the 2 s save, which main
   * answers `pending` when the change needs its confirmation. Null when the call failed.
   */
  async setCleanup(which: "archive" | "trash", on: boolean, hours: number, commit: boolean): Promise<{ saved: boolean; pending: boolean } | null> {
    const reply = await settingCall(() => window.vesta.settings.setCleanup({ which, on, hours, commit }));
    if (reply === null) return null;
    const r = reply.value;
    set((s) => ({ cleanup: { ...s.cleanup, [which]: { on: r.on, hours: r.hours, deadline: deadlineOf(r.remainingMs) } } }));
    return { saved: r.saved, pending: r.pending };
  },
  /** 018 FR-020d: the countdowns' time left, read when the Data pane shows (after a reopen or a restart). */
  async refreshCleanupStatus(): Promise<void> {
    try {
      const r = await window.vesta.cleanup.status();
      if (!r.ok) return;
      set((s) => ({
        cleanup: {
          archive: { ...s.cleanup.archive, deadline: deadlineOf(r.value.archive.remainingMs) },
          trash: { ...s.cleanup.trash, deadline: deadlineOf(r.value.trash.remainingMs) },
        },
      }));
    } catch (err) {
      reportError("store.cleanupStatus", err);
    }
  },
  async setUpdateReminderDays(days: number): Promise<boolean> {
    if (
      (await settingCall(() =>
        window.vesta.settings.setUpdateReminderDays({ days }),
      )) === null
    )
      return false;
    set({ updateReminderDays: days });
    return true;
  },
  /** 011 FR-016: one write for the lists that changed; main stamps pin times and cleans the recent list. */
  async setColorLists(next: {
    pinned?: string[];
    recent?: string[];
    pinnedNow?: string;
  }): Promise<boolean> {
    const payload = {
      pinned: next.pinned ?? null,
      recent: next.recent ?? null,
      pinnedNow: next.pinnedNow ?? null,
    };
    // Shown at once, so the open picker re-renders; a failed save puts the saved lists back (FR-039).
    const before = {
      pinnedColors: get().pinnedColors,
      recentColors: get().recentColors,
    };
    const pinned = next.pinned ?? before.pinnedColors;
    set({
      pinnedColors: pinned,
      recentColors: (next.recent ?? before.recentColors).filter(
        (h) => !pinned.includes(h),
      ),
    });
    if (
      (await settingCall(() =>
        window.vesta.settings.setColorLists(payload),
      )) === null
    ) {
      set(before);
      return false;
    }
    return true;
  },
  /** 011 FR-020b: the order of the table size fields and size text. */
  async setTableRowsFirst(on: boolean): Promise<boolean> {
    if (
      (await settingCall(() =>
        window.vesta.settings.setTableRowsFirst({ on }),
      )) === null
    )
      return false;
    set({ tableRowsFirst: on });
    return true;
  },
  /** 016 FR-021, FR-022: a text color picked from the picker becomes the swatch. */
  async setLastTextColor(hex: string): Promise<boolean> {
    set({ lastTextColor: hex });
    return (await settingCall(() => window.vesta.settings.setLastTextColor({ hex }))) !== null;
  },
  /** 010 FR-033 (Q133): main says a reminder is due; it waits behind any other notice and while Settings is open. */
  showReminder(): void {
    const plan = planReminder("due", {
      settingsOpen: get().settingsOpen,
      queued: get().reminderQueued,
    });
    set({ reminderQueued: plan.queued });
    if (plan.show) notify({ type: "showReminder" });
  },
  /** 009 FR-021, FR-025: resolves when the check ends; the state events show progress. */
  async checkForUpdates(): Promise<void> {
    try {
      const r = await window.vesta.updates.check();
      if (r.ok) actions.applyUpdateState(r.value);
      else
        reportError(`store.checkForUpdates ${r.error.code}`, r.error.message);
    } catch (err) {
      reportError("store.checkForUpdates", err);
    }
  },
  /** 009 FR-024b: main opens the address it checked; the renderer never sends one. */
  openUpdateLink(target: "file" | "release"): void {
    void window.vesta.updates.open({ target }).catch((err: unknown) => {
      reportError("store.openUpdateLink", err);
    });
  },
  openLogViewer(): void {
    set({ logViewerOpen: true });
  },
  closeLogViewer(): void {
    set({ logViewerOpen: false });
  },
  /** 008 FR-010 to FR-018: Settings → Export; the outcome shows in the section. */
  async exportData(includeLogs: boolean): Promise<void> {
    if (get().dataOp !== "idle") return;
    endUndoOffer();
    set({ dataOp: "exporting", dataMessage: null });
    try {
      const result = await window.vesta.data.export({ includeLogs });
      if (!result.ok) {
        reportError(
          `store.exportData ${result.error.code}`,
          result.error.message,
        );
        set({ dataMessage: { kind: "exportFailed" } });
        return;
      }
      const out = result.value;
      if (out.kind === "written")
        set({
          dataMessage: {
            kind: "exportWritten",
            fileName: out.fileName,
            folder: out.folder,
            skippedFiles: out.skippedFiles,
          },
        });
      if (out.kind === "failed") set({ dataMessage: { kind: "exportFailed" } });
      if (out.kind === "dataRefused") set({ dataMessage: { kind: "dataRefused" } });
    } catch (err) {
      reportError("store.exportData", err);
      set({ dataMessage: { kind: "exportFailed" } });
    } finally {
      set({ dataOp: "idle" });
    }
  },
  /** 008 FR-020 to FR-041: Settings → Import. A merge closes Settings and shows the importUndo notice (PRD Q121). */
  async importData(): Promise<void> {
    if (get().dataOp !== "idle") return;
    endUndoOffer();
    set({ dataOp: "importing", dataMessage: null });
    let merged: {
      token: string;
      deadline: number;
      counts: { added: number; updated: number; unchanged: number };
    } | null = null;
    try {
      const result = await window.vesta.data.import();
      if (!result.ok) {
        reportError(
          `store.importData ${result.error.code}`,
          result.error.message,
        );
        set({ dataMessage: { kind: "notStarted" } });
        return;
      }
      const out = result.value;
      switch (out.kind) {
        case "cancelled":
          return;
        case "refused":
          set({ dataMessage: { kind: "refused", refusal: out.refusal } });
          return;
        case "notStarted":
          set({ dataMessage: { kind: "notStarted" } });
          return;
        case "dataRefused":
          set({ dataMessage: { kind: "dataRefused" } });
          return;
        case "failedRestored":
          replaceData(out.data);
          set({ dataMessage: { kind: "failedRestored" } });
          return;
        case "merged":
          replaceData(out.data);
          // Main's deadline on the renderer's clock: the time left is what matters.
          merged = {
            token: out.undo.token,
            deadline: rendererClock.now() + (out.undo.deadline - out.undo.now),
            counts: out.counts,
          };
          return;
      }
    } catch (err) {
      reportError("store.importData", err);
      set({ dataMessage: { kind: "notStarted" } });
    } finally {
      set({ dataOp: "idle" });
      if (merged !== null) {
        actions.closeSettings();
        set({ undoOffer: { token: merged.token, deadline: merged.deadline } });
        notify({
          type: "showImportUndo",
          token: merged.token,
          counts: merged.counts,
          deadline: merged.deadline,
        });
      }
    }
  },
  /** 008 FR-037b: Undo import from its notice. */
  async undoImport(): Promise<void> {
    const offer = get().undoOffer;
    if (
      offer === null ||
      visibleImportUndoToken(get().notifications) !== offer.token ||
      get().dataOp !== "idle"
    )
      return;
    set({ dataOp: "undoing" });
    try {
      const result = await window.vesta.data.undoImport({ token: offer.token });
      if (result.ok && result.value.kind === "undone") {
        replaceData(result.value.data);
        notify({ type: "importUndone" });
      } else if (!result.ok && result.error.code === "UNDO_EXPIRED") {
        // The offer ended in main first (its deadline passed): the notice goes, nothing was undone.
        notify({ type: "close" });
        actions.announce(t("undoImportEnded"));
      } else {
        if (!result.ok)
          reportError(
            `store.undoImport ${result.error.code}`,
            result.error.message,
          );
        notify({ type: "importUndoFailed" });
      }
    } catch (err) {
      reportError("store.undoImport", err);
      notify({ type: "importUndoFailed" });
    } finally {
      set({ dataOp: "idle", undoOffer: null });
    }
  },
  endUndoOffer,
  setCapture(capture: { action: ActionId } | null): void {
    set({ capture });
  },
  minimize(): void {
    void window.vesta.window.minimize();
  },
  setView(view: View): void {
    set({
      view,
      editingKey: null,
      menuFor: null,
      overrideFor: null,
      drag: null,
      dropIndicator: null,
      panelFor: null,
    });
  },
  startEditing(key: EditingKey): void {
    endUndoOffer(); // 008 analysis U4: no Undo import while an edit is open
    // 005 edge case: an inline title edit on another task's card closes the panel; its pending edit is saved
    // as the panel unmounts. Editing the panel's own item keeps it open.
    set((s) => {
      const otherTask =
        s.panelFor !== null && key !== s.panelFor && key in s.tasks;
      return {
        editingKey: key,
        menuFor: null,
        ...(otherTask ? { panelFor: null } : {}),
      };
    });
  },
  stopEditing(): void {
    set({ editingKey: null });
  },
  /**
   * Closes the current editor once the pointer is released, unless another editor opened meanwhile, so a
   * click that blurred the editor still lands where it was aimed (see pointer.ts).
   */
  stopEditingAfterRelease(): void {
    const key = get().editingKey;
    afterPointerRelease(() => {
      if (get().editingKey === key) set({ editingKey: null });
    });
  },
  openMenu(id: string | null): void {
    set({ menuFor: id, overrideFor: null });
  },
  create: (title: string, parentId: string | null) =>
    thenTick(
      run(() => window.vesta.tasks.create({ title, parentId })).then(pin),
    ),
  editTitle: (id: string, title: string) =>
    run(() => window.vesta.tasks.editTitle({ id, title })).then(pin),
  /** Expanding shows hidden subtasks: a tick plays any first blink they still owe (003 FR-021a). */
  setCollapsed: (id: string, collapsed: boolean) => {
    const call = run(() => window.vesta.tasks.setCollapsed({ id, collapsed }), { listAction: false });
    return collapsed ? call : thenTick(call);
  },
  markDone: (id: string) =>
    runUndoable("done", id, () => window.vesta.tasks.markDone({ id })),
  delete: (id: string) =>
    runUndoable("delete", id, () => window.vesta.tasks.delete({ id })),
  restore: (id: string) =>
    thenTick(
      runUndoable("restore", id, () => window.vesta.tasks.restore({ id })),
    ),
  deletePermanently: (id: string) =>
    run(() => window.vesta.tasks.deletePermanently({ id })),
  /** Moves have no undo notification, and the current one stays (004 FR-022); the tick after plays any first blink owed (FR-011a). */
  moveTask: (id: string, dest: MoveDest) =>
    thenTick(run(() => window.vesta.tasks.move({ id, dest }))),
  moveReminder: (id: string, beforeId: string | null) =>
    thenTick(run(() => window.vesta.reminders.move({ id, beforeId }))),
  /** No undo notification, and the current one stays (003 FR-033). */
  /** 015: `forMin` is a quick duration in minutes (Postpone For), or null for the reschedule tolerance. */
  reschedule: (id: string, forMin: number | null = null) =>
    // 016 FR-001: every path reschedules here, so every path offers the same Undo.
    thenTick(runUndoable("reschedule", id, () => window.vesta.tasks.reschedule({ id, forMin }))),
  /** Every change applies at once; the tick after it applies the new threshold (003 FR-036, FR-009). */
  setAlertOverride: (id: string, minutes: number | null) =>
    thenTick(run(() => window.vesta.tasks.setAlertOverride({ id, minutes }))),
  /** The Alert override panel replaces the menu at the same spot (003 FR-034). */
  openOverride(id: string | null): void {
    set({ overrideFor: id, menuFor: null });
  },
  /** 005 FR-001: one panel at a time; opening another task switches it. */
  openPanel(id: string): void {
    set({
      panelFor: id,
      menuFor: null,
      overrideFor: null,
      panelSave: { state: "idle", failedSticky: false },
    });
  },
  closePanel(): void {
    set({ panelFor: null, panelSave: { state: "idle", failedSticky: false } });
  },
  setPanelSave(panelSave: PanelSaveView): void {
    if (panelSave.state === "pending") endUndoOffer(); // 008 analysis U4: typing in the panel
    set({ panelSave });
  },
  /** Applied at once; saved in main (005 FR-005). */
  async setPanelWidth(px: number): Promise<void> {
    const width = clampPanelWidth(px);
    set({ panelWidth: width });
    const result = await window.vesta.settings.setPanelWidth({ px: width });
    if (!result.ok) reportError("store.setPanelWidth", result.error.message);
  },
  /**
   * Saves the details; the panel shows its own save state, never the bottom notice (005 FR-010).
   * Resolves true when saved.
   */
  async editDetails(id: string, details: string): Promise<boolean> {
    let result: Result<Mutation>;
    try {
      result = await window.vesta.tasks.editDetails({ id, details });
    } catch (err) {
      reportError("store.editDetails", err);
      return false;
    }
    if (!result.ok) {
      reportError(
        `store.editDetails ${result.error.code}`,
        result.error.message,
      );
      return false;
    }
    merge(result.value);
    pin(result.value);
    requery();
    return true;
  },
  /** A title saved from the panel: like editTitle, but a failure shows in the panel, not the bottom notice (005 FR-010). */
  async savePanelTitle(id: string, title: string): Promise<boolean> {
    let result: Result<Mutation>;
    try {
      result = await window.vesta.tasks.editTitle({ id, title });
    } catch (err) {
      reportError("store.savePanelTitle", err);
      return false;
    }
    if (!result.ok) {
      reportError(
        `store.savePanelTitle ${result.error.code}`,
        result.error.message,
      );
      return false;
    }
    merge(result.value);
    pin(result.value);
    requery();
    return true;
  },
  /** 016 FR-016: never while something is dragged. */
  openLinkMenu(target: LinkMenuTarget): void {
    if (get().drag !== null) return;
    set({ linkMenu: target, unsafeLinkPop: null });
  },
  closeLinkMenu(): void {
    set({ linkMenu: null });
  },
  showUnsafeLinkPop(at: HTMLElement | null): void {
    if (at === null) {
      set({ unsafeLinkPop: null });
      return;
    }
    const box = at.getBoundingClientRect();
    set({ unsafeLinkPop: { left: box.left, top: box.bottom, back: at }, linkMenu: null });
  },
  /**
   * 016 FR-016c (Q257): a click on an unsafe link in a list title or reminder starts editing with that link (the
   * n-th unsafe one) selected and the link panel open on it.
   */
  editUnsafeLink(key: EditingKey, index: number): void {
    unsafeLinkPending = index;
    actions.startEditing(key);
  },
  /** The editor that opens reads it once. */
  takeUnsafeLink(): number | null {
    const index = unsafeLinkPending;
    unsafeLinkPending = null;
    return index;
  },
  /** 017 PRD Q269: a store that fails like any change (a file while newer data is refused). */
  showSaveFailed(): void {
    notify({ type: "showSticky", kind: "saveFailed" });
  },
  showAssetNotice(text: string | null): void {
    set({ assetNotice: text === null ? null : { text } });
  },
  createReminder: (text: string) =>
    run(() => window.vesta.reminders.create({ text })).then(pin),
  editReminderText: (id: string, text: string) =>
    run(() => window.vesta.reminders.editText({ id, text })).then(pin),
  deleteReminder: (id: string) =>
    runUndoable("delete", id, () => window.vesta.reminders.delete({ id })),
  markReminderDone: (id: string) =>
    runUndoable("done", id, () => window.vesta.reminders.markDone({ id })),
  setRemindersCollapsed: (collapsed: boolean) =>
    run(() => window.vesta.reminders.setCollapsed({ collapsed }), { listAction: false }),
  restoreReminder: (id: string) =>
    runUndoable("restore", id, () => window.vesta.reminders.restore({ id })),
  deleteReminderPermanently: (id: string) =>
    run(() => window.vesta.reminders.deletePermanently({ id })),
  /**
   * 013 FR-018 (PRD Q175, Q187): Delete Permanently asks in a native dialog naming the item; Cancel keeps it. An item
   * that left the Trash meanwhile is not touched.
   */
  async confirmDeletePermanently(id: string): Promise<void> {
    const reply = await window.vesta.dialog.confirmDeleteForever({
      title: itemTitle(id),
    });
    if (!reply.ok || !reply.value.confirmed) return;
    const s = get();
    const task = s.tasks[id];
    if (task !== undefined) {
      if (task.deletedAt !== null) await actions.deletePermanently(id);
      return;
    }
    if (s.reminders[id]?.deletedAt != null)
      await actions.deleteReminderPermanently(id);
  },
  async undo(): Promise<boolean> {
    const shown = get().notifications.current;
    const token = visibleUndoToken(get().notifications);
    if (token === null) return false;
    const title = shown?.type === "undo" ? shown.title : "";
    notify({ type: "close" });
    // 010 FR-009 (L1): a token main refuses is a page defect, not a lost edit: no notice (convergence T093).
    const value = await run(() => window.vesta.undo.apply({ token }), { quietInvalid: true });
    // 016 FR-003: an undone reschedule offers its Redo for the same 10 s.
    if (value?.redoToken !== undefined) notify({ type: "showRedo", token: value.redoToken, title });
    tickRequester();
    return true;
  },
  /** 016 FR-004: redoes the undone reschedule while its notice shows; false when there is none. */
  async redo(): Promise<boolean> {
    const shown = get().notifications.current;
    const token = visibleRedoToken(get().notifications);
    if (token === null) return false;
    const title = shown?.type === "redo" ? shown.title : "";
    notify({ type: "close" });
    const value = await run(() => window.vesta.undo.redo({ token }), { quietInvalid: true });
    if (value !== null) notify({ type: "showUndo", kind: "reschedule", token: value.undoToken, title });
    tickRequester();
    return true;
  },
  closeNotification(): void {
    notify({ type: "close" });
  },
  tick(): void {
    notify({ type: "tick" });
  },
  removeRows(ids: readonly string[]): void {
    merge({ upserts: [], removals: [...ids] });
    requery();
  },
  /** 015 FR-016: loads one task's history for its panel; later replies keep it current (research §5). */
  async loadHistory(id: string): Promise<void> {
    const result = await window.vesta.tasks.history({ id });
    if (result.ok)
      set((s) => ({ history: { ...s.history, [id]: result.value } }));
  },
  /** Applies an alert tick: its rows, main's time, and its episodes starting at `startedAt` (003 research §4). */
  applyAlertTick(tick: AlertTick, startedAt: number): void {
    merge(tick);
    set((s) => {
      const episodes = { ...s.episodes };
      for (const e of tick.episodes)
        episodes[e.id] = { blinks: e.blinks, startedAt };
      return { now: tick.now, episodes };
    });
  },
  /** Ends an episode, unless a newer one started on the same row meanwhile. */
  endEpisode(id: string, startedAt: number): void {
    set((s) => {
      if (s.episodes[id]?.startedAt !== startedAt) return {};
      const episodes = { ...s.episodes };
      Reflect.deleteProperty(episodes, id);
      return { episodes };
    });
  },
  /** Restarts an episode that waited for an inline edit to close (spec edge case). */
  restartEpisode(id: string, startedAt: number): void {
    set((s) => {
      const e = s.episodes[id];
      return e === undefined
        ? {}
        : { episodes: { ...s.episodes, [id]: { ...e, startedAt } } };
    });
  },
  startDrag(
    id: string,
    kind: "task" | "rem",
    frozen: FrozenNode[] | null,
  ): void {
    endUndoOffer(); // 008 analysis U4
    set({ drag: { id, kind, frozen }, dropIndicator: null });
  },
  endDrag(): void {
    set({ drag: null, dropIndicator: null });
  },
  setDropIndicator(dropIndicator: DropBox | null): void {
    set({ dropIndicator });
  },
  setMovingDisabled(movingDisabled: boolean): void {
    set({ movingDisabled });
  },
  setFocusAfterMove(focusAfterMove: { id: string; ctl: string } | null): void {
    set({ focusAfterMove });
  },
  announce(text: string): void {
    set((s) => ({
      announcement: { text, seq: (s.announcement?.seq ?? 0) + 1 },
    }));
  },
  removeReminderRows(ids: readonly string[]): void {
    merge({
      upserts: [],
      removals: [],
      reminders: { upserts: [], removals: [...ids] },
    });
    requery();
  },
  /** FR-001, FR-002, FR-020: typing in the box; from the Archive or Trash view it opens the main view. */
  setSearchText(text: string): void {
    if (isSearchActive(text) && get().view !== "tasks")
      actions.setView("tasks");
    queryChanged({ text });
  },
  clearSearch(): void {
    queryChanged({ text: "" });
  },
  toggleMatchCase(): void {
    queryChanged({ matchCase: !get().search.matchCase });
  },
  toggleExactPhrase(): void {
    queryChanged({ exactPhrase: !get().search.exactPhrase });
  },
  /** FR-016, FR-017: the checkbox adds the Archive and Trash section; items kept in view stay. */
  setIncludeArchiveTrash(includeArchiveTrash: boolean): void {
    set((s) => ({ search: { ...s.search, includeArchiveTrash } }));
    void runSearch();
  },
  /** A background index fill ended (search:indexed, FR-025): the waiting search runs again. */
  searchIndexed(): void {
    requery();
  },
};

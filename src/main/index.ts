import { randomUUID } from "node:crypto";
import { buildCleanupHandlers } from "./ipc/cleanup-handlers";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { BrowserWindow, ClipboardItem, Menu, app, clipboard, dialog, ipcMain, nativeTheme, net, powerMonitor, session, shell } from "electron";
import type { StartupOutcome } from "../domain/startup-outcome";
import type { EventChannel, EventMap } from "../shared/ipc-contract";
import { createAppClock, type ClockHook } from "./clock";
import { startBackupScheduler } from "./backup/scheduler";
import { ensureDataDir, isWritable, resolveDataDir, tightenMode } from "./data-dir";
import { afterMigrate } from "./db/connection";
import { createFatalHandler, readMarker } from "./startup/fatal";
import { purgeExpired, purgeRulesAt } from "./db/purge";
import { loadAlertSettings, loadAssetTypesRecomputed, loadLogSettings, loadPanelWidth, loadUiSettings, saveAssetTypesRecomputed, saveUpdateNotice, saveUpdateReminderAnchor } from "./db/settings-repo";
import { recordFloor } from "../domain/logs/levels";
import { effectiveMap } from "../domain/shortcuts/map";
import { quickDurations } from "../domain/alert-settings";
import { createI18n } from "../shared/i18n";
import { createCaptureForwarder } from "./keys";
import { LanguageWatcher, osLanguageSource } from "./language";
import { AlertSession } from "./alert-session";
import { initFaults } from "./faults";
import { buildAssetAsyncHandlers, buildHandlers, registerHandlers, type HandlerDeps } from "./ipc/handlers";
import { createFill, type Fill } from "./search/fill";
import { createWorkerPool } from "./search/pool";
import { errorMessage, initLog, log, setFloor, watch } from "./log";
import { buildLogHandlers } from "./ipc/log-handlers";
import { buildUpdateHandlers } from "./ipc/update-handlers";
import { checkForUpdate } from "./updates/check";
import { RELEASE_REPO, readmeUrl, releaseTagUrl } from "./updates/repo";
import { applyDockBadge } from "./updates/dock-badge";
import { UpdateScheduler } from "./updates/scheduler";
import {
  assertProbeAllowed,
  createFixtureTransport,
  createNetTransport,
  readSourceSetting,
  type FixtureTransport,
  type ReleaseSource,
  type UpdateTransport,
} from "./updates/transport";
import { networkAllowed } from "./security";
import { buildMenu } from "./menu";
import { MenuController } from "./menu-controller";
import { buildMenuHandlers } from "./ipc/menu-handlers";
import { menuCommand, type MenuCommandId } from "../domain/menu/commands";
import { startPurgeScheduler, type PurgeScheduler } from "./purge-scheduler";
import { assertOwnedDir, markTempDir, openReadOnlyCopy, removeTempDirs, sweepTempDirs } from "./startup/read-only";
import { openWithRecovery } from "./startup/recover";
import { UndoStore } from "./undo-store";
import { applyContentsSecurity, clearPlayerStorage, isTrustedSender, applySessionSecurity } from "./security";
import { handleAssetProtocol, registerAssetScheme } from "./assets/protocol";
import { serializeConfirm } from "./assets/store";
import { APP_INDEX_URL } from "./app-files";
import { handleAppProtocol } from "./app-protocol";
import { needsNoSandbox, refusedSwitches } from "../domain/startup/switches";
import { userNamespacesBlocked } from "./sandbox-probe";
import { windowIcon, windowPreferences } from "./window-prefs";
import { surfacesOf } from "../domain/theme-surfaces";
import { DEFAULT_PALETTE, type PaletteSetting } from "../domain/settings";
import { getAsset, recomputeAssetTypes } from "./db/assets-repo";
import { runColorRewrite } from "./db/colors-rewrite";
import { buildDataHandlers } from "./ipc/data-handlers";
import { OperationGate } from "./operation-gate";
import { UndoImportOffer } from "./import/undo-offer";
import type { DataSnapshot } from "../shared/ipc-contract";

// 017 FR-006a (PRD Q265, constitution v1.2.0 principle II): on a packaged Linux build, the same probe the AppImage
// launcher runs tells whether the system blocks the user namespaces Chromium's sandbox needs (research §11).
const sandboxBlocked = app.isPackaged && process.platform === "linux" ? userNamespacesBlocked() : false;
const switchContext = { platform: process.platform, packaged: app.isPackaged, sandboxBlocked };
/** Set when this start runs without Chromium's sandbox; logged once the log exists (openData). */
let sandboxDisabledVia: "launcher" | "app" | null = null;

// 010 FR-022 (L12): a packaged build refuses debugging, proxy and certificate switches before anything else runs.
if (app.isPackaged) {
  const refused = refusedSwitches((name) => app.commandLine.hasSwitch(name), process.argv, switchContext);
  if (refused.length > 0) {
    process.stderr.write(`Vesta refuses to start with: ${refused.map((s) => `--${s}`).join(" ")}\n`);
    app.exit(1);
  }
  if (sandboxBlocked) {
    const present = app.commandLine.hasSwitch("no-sandbox") || process.argv.includes("--no-sandbox");
    // The .tar.gz has no launcher to pass the switch; the AppImage's launcher passes it itself.
    if (needsNoSandbox({ ...switchContext, present })) app.commandLine.appendSwitch("no-sandbox");
    sandboxDisabledVia = present ? "launcher" : "app";
  }
}

// FR-040: anything that escapes is still written to the local log; 010 FR-026 (L16): the handler is installed once
// the data folder is known (below), and an unhandled rejection stays log-only.
process.on("unhandledRejection", (reason) => {
  log.error("main.unhandled-rejection", {
    message: errorMessage(reason),
    stack: reason instanceof Error ? (reason.stack ?? null) : null,
  });
});

// Electron names the data folder after the app; PRD B2 wants "Vesta" (research.md §8).
app.setName("Vesta");
// 009 FR-022, research §13: no background requests from the engine itself. The NetLog spec is the proof;
// these switches are defense in depth.
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("dns-prefetch-disable");
initFaults(app.isPackaged);

// One app clock for every main-process consumer; unpackaged builds can shift and move it (003 research §8).
const { clock: appClock, issues: clockIssues } = createAppClock({
  isPackaged: app.isPackaged,
  env: process.env,
  register: (hook: ClockHook) => {
    (globalThis as { __vestaClock?: ClockHook }).__vestaClock = hook;
  },
});

// The data folder is settled before anything else, so Chromium's profile can follow it (research.md §8).
const dataDir = resolveDataDir(app);
let dataDirWritable = false;
try {
  ensureDataDir(dataDir);
  dataDirWritable = isWritable(dataDir);
} catch {
  dataDirWritable = false;
}
// Development and tests: VESTA_DATA_DIR also holds Chromium's profile, so the real folder is never touched.
if (!app.isPackaged && dataDir !== app.getPath("userData")) app.setPath("userData", dataDir);
// FR-038a: an unwritable data folder must not stop the app; Chromium's profile then lives in a temp folder.
// 010 FR-008 (M3): a fresh, random, owner-checked folder under the app's temp path, removed at quit (research §5).
const tempDirs: string[] = [];
if (!dataDirWritable) {
  try {
    const profile = mkdtempSync(join(app.getPath("temp"), "vesta-profile-"));
    assertOwnedDir(profile, process.getuid?.() ?? null);
    markTempDir(profile);
    tempDirs.push(profile);
    app.setPath("userData", profile);
  } catch (err) {
    process.stderr.write(`Vesta cannot create its temporary profile folder: ${errorMessage(err)}\n`);
    app.exit(1);
  }
}
// Chromium's session files (caches, storage) go to their own subfolder, out of the way of data.sqlite.
app.setPath("sessionData", join(app.getPath("userData"), "Session"));

// 010 FR-026 (L16): after an uncaught exception, log, leave a time-only marker, stop the schedulers, flush the page
// (2 s), close the database and exit 1. The next start shows the notice (startup.abnormalExitAt).
const fatal = createFatalHandler({
  log,
  now: () => appClock.now(),
  dataDir,
  writable: dataDirWritable,
  stopSchedulers: () => {
    stopPurge?.();
    stopBackup?.();
    updates?.stop();
  },
  flush: () => flushRenderer(),
  closeDb: () => {
    db?.close();
    db = null;
  },
  exit: (code) => {
    app.exit(code);
  },
});
process.on("uncaughtException", (err) => {
  void fatal(err);
});

const devUrl = !app.isPackaged ? (process.env["ELECTRON_RENDERER_URL"] ?? null) : null;
const devOrigin = devUrl !== null ? new URL(devUrl).origin : null;

let mainWindow: BrowserWindow | null = null;
let searchFill: Fill | null = null;
let db: Database.Database | null = null;
let startup: StartupOutcome | null = null;
let stopPurge: PurgeScheduler | null = null;
let stopBackup: (() => void) | null = null;
let alertSession: AlertSession | null = null;
/** 009: the update check (FR-021); started once the window has loaded. */
let updates: UpdateScheduler | null = null;
/**
 * 009 contracts/ipc.md "Test transport": unpackaged builds started with VESTA_TEST_RELEASES never use the network
 * transport for the update check; it is chosen once, here, before any window loads (FR-028).
 */
const testReleases = !app.isPackaged ? (process.env["VESTA_TEST_RELEASES"] ?? null) : null;
const fixture: FixtureTransport | null = testReleases === null ? null : createFixtureTransport(readSourceSetting(testReleases));
const netTransport: UpdateTransport = createNetTransport((url, init) => net.fetch(url, init));
const updateTransport: UpdateTransport = fixture?.transport ?? netTransport;
/** 009: stops the viewer's live tail when the window goes. */
let stopLogTail: (() => void) | null = null;
// 008 research §7: one export, import or Undo import offer at a time; backups and the purge wait for it.
const gate = new OperationGate();
const undoImportOffer = new UndoImportOffer(
  appClock,
  { setInterval, clearInterval: (h) => { clearInterval(h as NodeJS.Timeout); } },
  randomUUID,
);
/** Unpackaged builds: the next folder or file picker answers this instead of opening (contracts/ipc.md). */
let nextDialogPath: { path: string | null } | null = null;
/** Unpackaged builds (010 contracts/ipc.md "Test hooks"): the next confirmation dialog answers this, and what it would have shown. */
let nextConfirm: { answer: boolean } | null = null;
const confirmLog: { name: string; folder: string }[] = [];
// 007: the active language, capture forwarding and the menu that follows both (research §3, §10, §11).
let languageWatcher: LanguageWatcher | null = null;
// 013 research §3, §6: the menu's enabled state and the window it acts on.
let menuController: MenuController | null = null;
// 013 T029: unpackaged runs may record the help addresses instead of opening a browser.
let externalLog: string[] | null = null;
const capture = createCaptureForwarder((key) => {
  send("keys:captured", key);
});

const isMac = process.platform === "darwin";
let quitting = false;
let quitFlushed = false;
let flushWaiter: (() => void) | null = null;

/** Asks the renderer to commit open edits and waits for its answer, at most 2 s (FR-018, FR-039a). */
function flushRenderer(): Promise<void> {
  const win = mainWindow;
  if (win === null || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      flushWaiter = null;
      resolve();
    };
    const timer = setTimeout(() => {
      log.warn("flush.timeout");
      finish();
    }, 2000);
    flushWaiter = finish;
    send("app:flush", {});
  });
}

function send<E extends EventChannel>(event: E, payload: EventMap[E]): void {
  mainWindow?.webContents.send(event, payload);
}

/** Data folder, write test and database recovery, before any window opens (FR-038a, FR-042, FR-042a). */
async function openData(): Promise<void> {
  initLog(dataDir);
  if (sandboxDisabledVia !== null) log.warn("sandbox.disabled", { reason: "user namespaces blocked", via: sandboxDisabledVia });
  for (const issue of clockIssues) log.warn("clock.offset-ignored", { issue });
  // 010 FR-008 (M3): folders a previous run could not remove (Chromium writes its profile after the last code runs).
  sweepTempDirs(app.getPath("temp"), tempDirs, log);
  // 010 FR-023 (L9): the folder's mode is tightened at every start; a failure is logged once, now that the log exists.
  if (dataDirWritable) tightenMode(dataDir, 0o700, { log });
  if (!dataDirWritable) {
    log.error("data-dir.not-writable", { dataDir });
    db = openReadOnlyCopy(dataDir, log, { tempRoot: app.getPath("temp"), register: (dir) => tempDirs.push(dir) });
    startup = { kind: "ok", folderNotWritable: true, dataDir, abnormalExitAt: null };
    return;
  }
  const recovered = await openWithRecovery({ dataDir, now: appClock.now(), log });
  db = recovered.db;
  // 017 FR-015a (PRD Q263): data saved by a newer Vesta stays as it is; db is an empty, query-only database.
  if (recovered.result.kind === "newerData") {
    log.error("db.newer-schema", { dataVersion: recovered.result.dataVersion, latestVersion: recovered.result.latestVersion });
  } else {
    // 010 FR-024 (L15): secure deletion for the search index and incremental vacuum, once after the migrations.
    afterMigrate(db);
  }
  startup = { ...recovered.result, folderNotWritable: false, dataDir, abnormalExitAt: readMarker(dataDir) };
  log.info("app.started", { dataDir, version: app.getVersion(), startup: recovered.result.kind });
}

/** 009 FR-010: Info until the stored level is read, then the floor it selects; unreadable rows are logged. */
function applyStoredLogLevel(): void {
  if (db === null) return;
  const stored = loadLogSettings(db);
  setFloor(recordFloor(stored.logLevel));
  for (const issue of stored.issues) log.warn("settings.issue", { ...issue });
}

/**
 * The data may be written: the folder is writable (FR-038a) and the data is not refused as newer (017 FR-015a). Backups,
 * the purge, import, export, stored files and the one-time rewrites all wait on it.
 */
function dataWritable(): boolean {
  return startup !== null && !startup.folderNotWritable && startup.kind !== "newerData";
}

/** Automatic backups once the window can hear their notices (FR-041 to FR-041b). */
function startBackups(): void {
  if (stopBackup !== null || !dataWritable()) return;
  stopBackup = startBackupScheduler({
    clock: appClock,
    dataDir,
    db: () => {
      if (db === null) throw new Error("database not open");
      return db;
    },
    log,
    onFailed: (lastBackupAt) => {
      send("notice:backup-failed", { lastBackupAt });
    },
    onDamaged: () => {
      send("notice:data-damaged", {});
    },
    gate,
  });
}

/** The OS folder or file picker for export and import (008 FR-010, FR-020); null when cancelled. */
async function pickPath(kind: "folder" | "file"): Promise<string | null> {
  if (!app.isPackaged && nextDialogPath !== null) {
    const { path } = nextDialogPath;
    nextDialogPath = null;
    return path;
  }
  const options: Electron.OpenDialogOptions =
    kind === "folder"
      ? { properties: ["openDirectory", "createDirectory"] }
      : { properties: ["openFile"], filters: [{ name: "Vesta export", extensions: ["zip"] }] };
  const result = mainWindow === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(mainWindow, options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** 010 FR-019 (L4): the main window's main frame on the app origin (security.ts). */
function trustedSender(frame: Electron.WebFrameMain | null | undefined): boolean {
  return isTrustedSender(frame, mainWindow?.webContents.mainFrame ?? null, devOrigin);
}

/** The window background of the stored palette in the effective appearance (`--bg`), so the first frame is right. */
function windowBackground(palette: PaletteSetting): string {
  const bg = surfacesOf(nativeTheme.shouldUseDarkColors ? "dark" : "light", palette).surfaces[1] ?? "#f3efe7ff";
  return bg.slice(0, 7);
}

const iconOption = (icon: string | undefined): { icon?: string } => (icon === undefined ? {} : { icon });

function createWindow(): BrowserWindow {
  const palette = db === null ? DEFAULT_PALETTE : loadUiSettings(db, isMac).settings.palette;
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 360,
    minHeight: 420,
    show: false,
    title: "Vesta",
    backgroundColor: windowBackground(palette),
    // 017 FR-011a: the Linux window shows the Vesta icon; macOS and Windows take the app's own.
    ...iconOption(windowIcon({ platform: process.platform, packaged: app.isPackaged, resourcesPath: process.resourcesPath })),
    // HIG identity (B · Hearth): one unified toolbar in the title bar; the renderer leaves room for the traffic lights.
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 18 } } : {}),
    // 010 FR-021 (L5): no developer tools in packaged builds; the hardening itself comes from web-contents-created.
    webPreferences: windowPreferences({ isPackaged: app.isPackaged, preload: join(import.meta.dirname, "../preload/index.cjs") }),
  });
  // 007: shortcut capture sees keys before the menu; the OS language is re-read on focus (research §3, §11).
  win.webContents.on("before-input-event", (event, input) => {
    capture.onInput(event, input);
  });
  win.webContents.on("did-start-navigation", () => {
    capture.onNavigation();
  });
  win.on("blur", () => {
    capture.onBlur();
  });
  win.on("focus", () => {
    languageWatcher?.onFocus();
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  // The main view is visible only while the window is shown and not minimized (003 FR-018, research §3).
  alertSession?.setWindowVisible(false);
  const windowState = () => {
    // 013 FR-020: a hidden window (macOS) disables the selection and Format items and brings the globals' keys.
    menuController?.setWindowShown(win.isVisible());
    const visible = win.isVisible() && !win.isMinimized();
    alertSession?.setWindowVisible(visible);
    // Back on screen: the renderer ticks at once, which plays what came due meanwhile.
    if (visible) send("alerts:wake", {});
  };
  win.on("show", windowState);
  win.on("hide", windowState);
  win.on("minimize", windowState);
  win.on("restore", windowState);
  win.webContents.once("did-finish-load", startBackups);
  // 009 FR-021: the check at start runs once the window has loaded, never delaying the start.
  win.webContents.once("did-finish-load", () => {
    updates?.start();
  });
  win.webContents.once("did-finish-load", () => {
    searchFill?.start();
  });

  // FR-004a: macOS hides the window and keeps running; Windows and Linux quit. Edits are saved first.
  let closeFlushed = false;
  win.on("close", (event) => {
    if (closeFlushed || (quitting && quitFlushed)) return;
    event.preventDefault();
    void flushRenderer().then(() => {
      if (isMac && !quitting) {
        win.hide();
        return;
      }
      closeFlushed = true;
      win.close();
    });
  });
  win.on("closed", () => {
    stopLogTail?.();
    if (mainWindow === win) mainWindow = null;
  });
  // 010 FR-018 (L13): the built page is served from the app scheme, so the page has a real origin.
  if (devUrl !== null) void win.loadURL(devUrl);
  else void win.loadURL(APP_INDEX_URL);
  return win;
}

async function start(): Promise<void> {
  try {
    await openData();
  } catch (err) {
    log.fatal("app.start-failed", { message: errorMessage(err) });
    throw err;
  }
  applyStoredLogLevel();
  // 010 FR-004 (M2): once after the upgrade, every stored file's type is recomputed from its bytes and extension.
  if (db !== null && dataWritable() && !loadAssetTypesRecomputed(db)) {
    const t0 = performance.now();
    const recomputed = recomputeAssetTypes(db, dataDir);
    saveAssetTypesRecomputed(db, appClock.now());
    log.info("assets.types-recomputed", { count: recomputed.count, changed: recomputed.changed, ms: Math.round(performance.now() - t0) });
  }
  // 011 FR-015: once after the upgrade, every stored span color becomes 8-digit (updated_at untouched).
  if (db !== null && startup !== null) runColorRewrite(db, { writable: dataWritable(), now: appClock.now(), log });
  applySessionSecurity(session.defaultSession, { isPackaged: app.isPackaged, devOrigin, repo: RELEASE_REPO });
  // 010 FR-017 (I4): whatever the player left behind, including after an abnormal exit.
  void clearPlayerStorage(session.defaultSession).catch((err: unknown) => {
    log.warn("player.storage-clear-failed", { message: errorMessage(err) });
  });
  handleAppProtocol(join(import.meta.dirname, "../renderer"));
  handleAssetProtocol(
    () => ({
      dir: dataDir,
      find: (hash) => {
        const row = db === null ? null : getAsset(db, hash);
        return row === null ? null : { ext: row.ext, mimeType: row.mimeType };
      },
    }),
    (url) => {
      // 009 FR-003: the stored file's hash, never the address.
      log.warn("asset.not-found", { sha256: /[0-9a-f]{64}/.exec(url)?.[0] ?? null });
    },
  );

  alertSession = new AlertSession(appClock);
  const deps: HandlerDeps = {
    db: () => {
      if (db === null) throw new Error("database not open");
      return db;
    },
    clock: appClock,
    log,
    newId: randomUUID,
    startup: () => {
      if (startup === null) throw new Error("startup not finished");
      return startup;
    },
    onFlushDone: () => {
      flushWaiter?.();
    },
    undo: new UndoStore(appClock, randomUUID),
    alertSession: alertSession,
    alertSettings: () => loadAlertSettings(deps.db()).settings,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    dataDir,
    shell,
    dialog: {
      showOpenDialogSync: (options) =>
        mainWindow === null ? dialog.showOpenDialogSync(options) : dialog.showOpenDialogSync(mainWindow, options),
      // 010 M1 (FR-001): one dialog at a time, localized, Add as the default; the test hook answers without showing.
      confirmImport: serializeConfirm(async ({ name, folder }) => {
        if (!app.isPackaged && nextConfirm !== null) {
          confirmLog.push({ name, folder });
          const { answer } = nextConfirm;
          nextConfirm = null;
          return answer;
        }
        const t = createI18n(languageWatcher?.language() ?? "en").t;
        const options: Electron.MessageBoxOptions = {
          type: "question",
          message: t("fileConfirmTitle", { n: name }),
          detail: t("fileConfirmDetail", { folder }),
          buttons: [t("fileConfirmAdd"), t("fileConfirmCancel")],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        };
        const { response } = mainWindow === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(mainWindow, options);
        return response === 0;
      }),
    },
    platform: process.platform,
    // 016 FR-016: Copy and Copy Link (contracts/ipc.md "clipboard:write").
    clipboard: {
      write: (data) => {
        // Electron's clipboard takes W3C-style items: the plain text, and the formatted text when there is one.
        const item = new ClipboardItem(data.html === undefined ? { "text/plain": data.text } : { "text/plain": data.text, "text/html": data.html });
        clipboard.write([item]).catch((err: unknown) => {
          log.warn("clipboard.write.failed", { message: err instanceof Error ? err.message : String(err) });
        });
      },
    },
    searchIndex: {
      isPending: () => searchFill?.isPending() ?? false,
      kick: () => {
        searchFill?.kick();
      },
    },
  };
  // 006 research §4: the background fill indexes rows the triggers left missing or pending, extracting in
  // worker threads so main stays free; it starts once the window has loaded.
  const pool = createWorkerPool(join(import.meta.dirname, "search-worker.js"));
  searchFill = createFill(deps.db, pool.extract, () => {
    send("search:indexed", {});
  }, log);
  // FR-001: settings that were missing, unreadable or out of range are logged once per launch, not per tick.
  for (const issue of loadAlertSettings(deps.db()).issues) log.warn("settings.issue", { key: issue.key, kind: issue.kind });
  // 007: theme and language before the window exists, so its first frame is right (research §3, §6).
  const ui = loadUiSettings(deps.db(), isMac);
  for (const issue of ui.issues) log.warn("settings.issue", { ...issue });
  nativeTheme.themeSource = ui.settings.theme;
  const osLanguages = osLanguageSource({
    isPackaged: app.isPackaged,
    env: process.env,
    readOs: () => app.getPreferredSystemLanguages(),
  });
  const watcher = new LanguageWatcher({
    setting: ui.settings.language,
    read: osLanguages.read,
    timer: {
      setInterval,
      clearInterval: (h) => {
        clearInterval(h as NodeJS.Timeout);
      },
    },
    onChange: (language) => {
      rebuildMenu();
      send("settings:language", { language });
    },
    log,
  });
  languageWatcher = watcher;
  // 013 research §2, §6: a click sends its id; a command that needs the hidden window shows it first.
  const onMenuCommand = (id: MenuCommandId) => {
    const win = mainWindow;
    if (win === null) return;
    if (id === "minimize") {
      win.minimize();
      return;
    }
    if (!win.isVisible() && menuCommand(id).needsWindow) {
      win.once("show", () => {
        send("menu:command", { id });
      });
      win.show();
      win.focus();
      return;
    }
    send("menu:command", { id });
  };
  const menus = new MenuController({
    install: (options) => {
      const menu = buildMenu(options);
      Menu.setApplicationMenu(menu);
      return menu;
    },
    options: () => ({
      isPackaged: app.isPackaged,
      t: createI18n(watcher.language()).t,
      map: effectiveMap(loadUiSettings(deps.db(), isMac).settings.shortcuts, isMac),
      isMac,
      onCommand: onMenuCommand,
      quickDurations: quickDurations(loadAlertSettings(deps.db()).settings),
    }),
  });
  menuController = menus;
  const rebuildMenu = () => {
    menus.rebuild();
  };
  deps.settings = {
    isMac,
    nativeTheme,
    setLanguageSetting: (setting) => watcher.setSetting(setting),
    rebuildMenu,
    setCapture: (on) => {
      capture.setCapture(on);
    },
    minimizeWindow: () => {
      mainWindow?.minimize();
    },
  };
  // Unpackaged builds only: e2e tests replace the OS language list (contracts/ipc.md "Test hooks").
  if (!app.isPackaged) {
    (globalThis as { __vestaTest?: unknown }).__vestaTest = {
      setOsLanguages: osLanguages.setOsLanguages,
      checkLanguage: () => {
        watcher.check();
      },
      // 008 contracts/ipc.md "Test hooks".
      setNextDialogPath: (path: string | null) => {
        nextDialogPath = { path };
      },
      // 010 contracts/ipc.md "Test hooks".
      setNextConfirm: (answer: boolean | null) => {
        nextConfirm = answer === null ? null : { answer };
      },
      confirmRequests: () => [...confirmLog],
      // 013 T029: record the help addresses instead of opening them.
      recordExternal: () => {
        externalLog = [];
      },
      externalUrls: () => [...(externalLog ?? [])],
      tempDirs: () => [...tempDirs],
      throwUncaught: () => {
        setTimeout(() => {
          throw new Error("VESTA_TEST uncaught");
        }, 0);
      },
      undoOfferState: () => undoImportOffer.current(),
      // 009 contracts/ipc.md "Test hooks".
      setReleases: (source: ReleaseSource) => {
        if (fixture === null) throw new Error("setReleases needs VESTA_TEST_RELEASES");
        fixture.setSource(source);
      },
      updateRequests: () => fixture?.requests() ?? [],
      tickUpdates: () => updates?.tick() ?? Promise.resolve(),
      // 018 quickstart.md: the hourly purge with both cleanups, once, through the gate; no purge on refused newer data.
      runPurge: () => stopPurge?.runNow() ?? Promise.resolve(),
      logDir: () => join(dataDir, "logs"),
      probeBlockedFetch: async (url: string): Promise<boolean> => {
        assertProbeAllowed(url, (u) => networkAllowed(u, null, RELEASE_REPO));
        try {
          await netTransport(url, {
            method: "GET",
            headers: { "User-Agent": "Vesta" },
            credentials: "omit",
            cache: "no-store",
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
          });
          return false;
        } catch (err) {
          return /ERR_BLOCKED_BY_CLIENT/.test(errorMessage(err));
        }
      },
    };
  }
  const panel = loadPanelWidth(deps.db());
  if (panel.issue !== null) log.warn("settings.issue", { key: "panelWidth", kind: panel.issue });
  // 009: the log viewer and the level (contracts/ipc.md).
  const logHandlers = buildLogHandlers({ db: deps.db, clock: appClock, dataDir, log, watch, setFloor, send });
  stopLogTail = logHandlers.stop;
  // 009: the update check (FR-021 to FR-027); its first check waits for the window to load.
  const stored = loadLogSettings(deps.db());
  const scheduler = new UpdateScheduler({
    clock: appClock,
    check: () =>
      checkForUpdate({ transport: updateTransport, repo: RELEASE_REPO, running: app.getVersion(), platform: process.platform, arch: process.arch, log }),
    running: app.getVersion(),
    platform: process.platform,
    auto: stored.autoUpdateCheck,
    notice: stored.updateNotice,
    saveNotice: (notice) => {
      saveUpdateNotice(deps.db(), notice, appClock.now());
    },
    onState: (state) => {
      send("updates:state", state);
      // 013 FR-024: the Dock badge follows the mark on macOS only.
      if (isMac) applyDockBadge(app.dock, state);
    },
    // 010 Q133 (FR-033 to FR-035): the reminder while automatic checks are off; its anchor is local state.
    reminder: { on: stored.updateReminder, days: stored.updateReminderDays, anchor: stored.updateReminderAnchor },
    saveReminderAnchor: (at) => {
      saveUpdateReminderAnchor(deps.db(), at, appClock.now());
    },
    onReminder: (at) => {
      send("updates:reminder", { at });
    },
  });
  updates = scheduler;
  // 013 FR-024: an unseen newer version from an earlier run keeps its Dock badge at start.
  if (isMac) applyDockBadge(app.dock, scheduler.state());
  deps.updateState = () => scheduler.state();
  const updateHandlers = buildUpdateHandlers({ db: deps.db, clock: appClock, scheduler: () => scheduler, shell, repo: RELEASE_REPO, log });
  // 013 contracts/ipc.md: the menu state, the Delete Permanently confirmation and the help addresses.
  const confirmDeleteForever = serializeConfirm(async ({ name }) => {
    if (!app.isPackaged && nextConfirm !== null) {
      confirmLog.push({ name, folder: "" });
      const { answer } = nextConfirm;
      nextConfirm = null;
      return answer;
    }
    const t = createI18n(languageWatcher?.language() ?? "en").t;
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      message: t("confirmDeleteForever", { item: name }),
      detail: t("confirmDeleteForeverDetail"),
      buttons: [t("confirmDeleteForeverButton"), t("cancel")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const { response } = mainWindow === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(mainWindow, options);
    return response === 0;
  });
  // 018 contracts/ipc-cleanup.md: the cleanup confirmations, native boxes like Delete Permanently's; unpackaged builds
  // answer them through __vestaTest.setNextConfirm and record them, with their message key and count, in confirmRequests.
  const confirmCleanup = serializeConfirm(async ({ name, folder }) => {
    if (!app.isPackaged && nextConfirm !== null) {
      confirmLog.push({ name, folder });
      const { answer } = nextConfirm;
      nextConfirm = null;
      return answer;
    }
    const t = createI18n(languageWatcher?.language() ?? "en").t;
    const trashOff = name === "confirmTrashOff";
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      message: trashOff ? t("confirmTrashOff") : t(name === "confirmCleanupArchive" ? "confirmCleanupArchive" : "confirmCleanupTrash", { count: Number(folder) }),
      detail: t(trashOff ? "confirmTrashOffDetail" : "confirmCleanupDetail"),
      buttons: [t(trashOff ? "confirmTrashOffButton" : "confirmCleanupButton"), t("cancel")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const { response } = mainWindow === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(mainWindow, options);
    return response === 0;
  });
  const cleanupHandlers = buildCleanupHandlers({
    db: deps.db,
    clock: appClock,
    log,
    confirm: ({ kind, count }) =>
      confirmCleanup({ name: kind === "trashOff" ? "confirmTrashOff" : kind === "cleanupArchive" ? "confirmCleanupArchive" : "confirmCleanupTrash", folder: String(count) }),
  });
  const menuHandlers = buildMenuHandlers({
    setMenuState: (state) => {
      menus.setState(state);
    },
    confirmDeleteForever: (title) => confirmDeleteForever({ name: title, folder: "" }),
    helpUrls: () => ({ readme: readmeUrl(RELEASE_REPO), release: releaseTagUrl(RELEASE_REPO, app.getVersion()) }),
    openExternal: async (url) => {
      if (externalLog !== null) {
        externalLog.push(url);
        return;
      }
      await shell.openExternal(url);
    },
    log,
  });
  const handlers = { ...buildHandlers(deps), ...logHandlers.handlers, ...updateHandlers.handlers, ...menuHandlers.handlers };
  const snapshot = (): DataSnapshot => {
    const initial = handlers["app:get-initial-state"]?.(undefined);
    if (initial === undefined) throw new Error("initial state is not available");
    const { startup: _startup, testHooks: _testHooks, isMac: _isMac, appVersion: _appVersion, update: _update, ...data } = initial;
    return data;
  };
  const dataHandlers = buildDataHandlers({
    db: deps.db,
    dataDir,
    clock: appClock,
    log,
    appVersion: app.getVersion(),
    isMac,
    gate,
    flushRenderer,
    pickPath,
    dataRefused: () => startup?.kind === "newerData",
    timezoneOffset: (now) => new Date(now).getTimezoneOffset(),
    snapshot,
    offer: undoImportOffer,
    // FR-040: theme, language and menu follow the merged (or restored) settings at once.
    applySettings: () => {
      const stored = loadUiSettings(deps.db(), isMac).settings;
      nativeTheme.themeSource = stored.theme;
      watcher.setSetting(stored.language);
      rebuildMenu();
      // 009 FR-017, FR-021a: an imported (or restored) log level and update switch apply at once.
      const imported = loadLogSettings(deps.db());
      setFloor(recordFloor(imported.logLevel));
      if (scheduler.state().auto !== imported.autoUpdateCheck) scheduler.setAuto(imported.autoUpdateCheck);
      // 010 Q133: an imported (or restored) reminder switch and period apply at once.
      if (scheduler.reminderState().on !== imported.updateReminder) scheduler.setReminder(imported.updateReminder);
      if (scheduler.reminderState().days !== imported.updateReminderDays) scheduler.setReminderDays(imported.updateReminderDays);
    },
    onDataDamaged: () => {
      send("notice:data-damaged", {});
    },
    kickSearch: () => {
      searchFill?.kick();
    },
    // 010 L10 (FR-014): unpackaged runs may fake the free space for the end-to-end test (contracts/ipc.md).
    freeBytes: !app.isPackaged && process.env["VESTA_TEST_FREE_BYTES"] !== undefined ? () => Number(process.env["VESTA_TEST_FREE_BYTES"]) : undefined,
  });
  // FR-037b: any change to an item or a setting ends a pending Undo import offer first.
  registerHandlers(ipcMain, handlers, deps, trustedSender, { ...dataHandlers, ...logHandlers.asyncHandlers, ...updateHandlers.asyncHandlers, ...menuHandlers.asyncHandlers, ...cleanupHandlers, ...buildAssetAsyncHandlers(deps) }, () => {
    undoImportOffer.end();
  });

  // Sleep counts as the main view not being visible; on wake the renderer ticks at once (003 FR-010, FR-018).
  powerMonitor.on("suspend", () => {
    alertSession?.suspend();
  });
  powerMonitor.on("resume", () => {
    void updates?.tick();
    alertSession?.resume();
    send("alerts:wake", {});
  });

  rebuildMenu();
  mainWindow = createWindow();

  // FR-035: purge at launch and every hour; never on refused newer data (017 FR-015a).
  if (startup?.kind === "newerData") return;
  let lastPurge: { removals: string[]; reminderRemovals: string[] } = { removals: [], reminderRemovals: [] };
  stopPurge = startPurgeScheduler({
    clock: appClock,
    timer: { setInterval, clearInterval: (h) => { clearInterval(h as NodeJS.Timeout); } },
    // Tasks and reminders in one transaction (002 FR-019); the scheduler logs and retries as for 001. Each run reads both
    // cleanups; one that is off or waits out the hour after a change is skipped (018 FR-017, FR-020b).
    purge: (now) => {
      const out = purgeExpired(deps.db(), now, { dir: dataDir, log }, purgeRulesAt(deps.db(), now));
      lastPurge = { removals: out.removals, reminderRemovals: out.reminderRemovals };
      return { ids: [...out.removals, ...out.reminderRemovals], archive: out.archive, trash: out.trash };
    },
    onPurged: () => {
      send("tasks:purged", lastPurge);
    },
    log,
    gate,
    // 018 T066: after the window's first paint; the listener runs after createWindow's, which shows it.
    afterShown: (fn) => {
      if (mainWindow === null || mainWindow.isVisible()) fn();
      else mainWindow.once("ready-to-show", fn);
    },
  });
}

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    if (app.isReady() && db !== null) mainWindow = createWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

/** 008 edge case: quitting while an import runs waits for it to end (its offer then ends on quit). */
async function importFinished(): Promise<void> {
  while (gate.state() === "importing") await new Promise((r) => setTimeout(r, 100));
}

app.on("before-quit", (event) => {
  quitting = true;
  if (quitFlushed) return;
  event.preventDefault();
  const finish = () => {
    quitFlushed = true;
    app.quit();
  };
  void flushRenderer()
    .then(importFinished)
    // 010 FR-017 (I4): the player's cookies, storage and cache do not survive the quit. The session exists only once
    // the app is ready: a second instance quits before that (FR-004), and a failed clean-up never blocks the quit.
    .then(() =>
      app.isReady()
        ? clearPlayerStorage(session.defaultSession).catch((err: unknown) => {
            log.warn("player.storage-clear-failed", { message: errorMessage(err) });
          })
        : undefined,
    )
    .then(finish, (err: unknown) => {
      log.error("quit.cleanup-failed", { message: errorMessage(err) });
      finish();
    });
});

app.on("will-quit", () => {
  // FR-037a: the offer ends (the pre-import backup becomes the latest) before the data is closed.
  undoImportOffer.end();
  stopPurge?.();
  stopBackup?.();
  updates?.stop();
  db?.close();
  db = null;
  // 010 FR-008 (M3): the temporary profile and read-only copy, if any, go with the quit.
  removeTempDirs(tempDirs, log);
});
// 010 FR-008 (M3): Chromium may still write its profile during shutdown; the last attempt runs as the process ends.
process.on("exit", () => {
  removeTempDirs(tempDirs, {
    warn: (event, fields) => {
      // The logger may be closed by now; stderr is the last channel left.
      process.stderr.write(`${event} ${JSON.stringify(fields)}\n`);
    },
  });
});

registerAssetScheme();
// 010 FR-021 (L5): every web contents the app creates gets the same hardening as the main window.
app.on("web-contents-created", (_event, contents) => {
  applyContentsSecurity(contents, { isPackaged: app.isPackaged, devOrigin });
});

// FR-004: one instance; a second launch brings the existing window back.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
  void app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      log.fatal("app.start-failed", { message: errorMessage(err) });
      app.exit(1);
    });
}

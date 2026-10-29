/** 007 settings, window and capture handlers on a temp database (contracts/ipc.md "Behaviour notes"). */
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { fakeClock } from "../../../src/domain/clock";
import type { Lang, LanguageSetting } from "../../../src/domain/language";
import { AlertSession } from "../../../src/main/alert-session";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { loadAlertSettings } from "../../../src/main/db/settings-repo";
import { applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import type { Task } from "../../../src/domain/task";
import { mk } from "../domain/fixtures";
import { initFaults } from "../../../src/main/faults";
import { buildHandlers, dispatch, type HandlerDeps, type SettingsDeps } from "../../../src/main/ipc/handlers";
import type { Logger } from "../../../src/main/log";
import { UndoStore } from "../../../src/main/undo-store";
import { tempDir } from "../db/helpers";

const T = 1_000_000_000_000;

describe("007 settings handlers", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let deps: HandlerDeps;
  let settings: SettingsDeps;
  let rebuildMenu: ReturnType<typeof vi.fn<() => void>>;
  let setCapture: ReturnType<typeof vi.fn<(on: boolean) => void>>;
  let minimizeWindow: ReturnType<typeof vi.fn<() => void>>;
  let log: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const clock = fakeClock(T);
    log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    rebuildMenu = vi.fn<() => void>();
    setCapture = vi.fn<(on: boolean) => void>();
    minimizeWindow = vi.fn<() => void>();
    settings = {
      isMac: false,
      nativeTheme: { themeSource: "system" },
      setLanguageSetting: (s: LanguageSetting): Lang => (s === "system" ? "en" : s),
      rebuildMenu,
      setCapture,
      minimizeWindow,
    };
    deps = {
      db: () => db,
      clock,
      log: log as unknown as Logger,
      newId: () => "00000000-0000-4000-8000-0000000000aa",
      startup: () => ({ kind: "ok", folderNotWritable: false, abnormalExitAt: null, dataDir: dir }),
      onFlushDone: () => undefined,
      undo: new UndoStore(clock, () => "token"),
      alertSession: new AlertSession(clock),
      alertSettings: () => loadAlertSettings(db).settings,
      isPackaged: false,
      dataDir: dir,
      shell: { openPath: vi.fn(() => Promise.resolve("")), showItemInFolder: vi.fn(), openExternal: vi.fn(() => Promise.resolve()) },
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "linux",
      settings,
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  const run = (channel: Parameters<typeof dispatch>[2], payload: unknown) => dispatch(buildHandlers(deps), deps, channel, payload);
  const value = (key: string) =>
    db.prepare("select value, updated_at from settings where key = ?").get(key) as { value: string; updated_at: number };

  it("settings:set-alert stores the value and returns the alert settings, and no tasks for another key (012)", () => {
    const r = run("settings:set-alert", { key: "reblinkIntervalMin", minutes: 30 });
    expect(r).toEqual({ ok: true, value: { settings: { ...DEFAULT_ALERT_SETTINGS, reblinkIntervalMin: 30 }, tasks: [] } });
    expect(value("reblinkIntervalMin")).toEqual({ value: "30", updated_at: T });
  });

  describe("012 FR-026 the global alert period and stale tasks", () => {
    const DAY = 86_400_000;
    // Created 2 days before now (T), stale since 1 day after creation under the 24 h default.
    const stale = mk({ createdAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY, staleSince: T - DAY, wasStale: true, lastBlinkAt: T - DAY, updatedAt: T - 2 * DAY });
    const row = () => loadAll(db).find((t) => t.id === stale.id);

    it("FR-026 FR-031 a longer global period un-stales in the same transaction; the last edit is unchanged", () => {
      applyChangeSet(db, { upserts: [stale], removals: [] });
      const r = run("settings:set-alert", { key: "alertPeriodMin", minutes: 7 * 1440 });
      expect(r).toMatchObject({ ok: true, value: { settings: { alertPeriodMin: 7 * 1440 } } });
      const tasks = (r as { value: { tasks: Task[] } }).value.tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ id: stale.id, staleSince: null, wasStale: true, updatedAt: T - 2 * DAY });
      expect(row()).toMatchObject({ staleSince: null, updatedAt: T - 2 * DAY });
    });

    it("FR-026 a failed write saves neither the setting nor the task", () => {
      applyChangeSet(db, { upserts: [stale], removals: [] });
      process.env["VESTA_FAULT"] = "save";
      initFaults(false);
      expect(run("settings:set-alert", { key: "alertPeriodMin", minutes: 7 * 1440 })).toMatchObject({ ok: false });
      delete process.env["VESTA_FAULT"];
      initFaults(true);
      expect(value("alertPeriodMin").value).toBe("1440");
      expect(row()?.staleSince).toBe(T - DAY);
    });
  });

  it("settings:set-alert refuses a value outside the key's limits and writes nothing", () => {
    expect(run("settings:set-alert", { key: "reblinkIntervalMin", minutes: 29 })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(run("settings:set-alert", { key: "rescheduleToleranceMin", minutes: 43_201 })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(value("reblinkIntervalMin").value).toBe("240");
  });

  it("015 FR-013: a quick reschedule duration is stored and rebuilds the menu (Edit › Postpone For's labels); the other alert keys do not", () => {
    const r = run("settings:set-alert", { key: "quickReschedule3Min", minutes: 180 });
    expect(r).toMatchObject({ ok: true, value: { settings: { quickReschedule3Min: 180 } } });
    expect(value("quickReschedule3Min")).toEqual({ value: "180", updated_at: T });
    expect(rebuildMenu).toHaveBeenCalledTimes(1);
    run("settings:set-alert", { key: "reblinkIntervalMin", minutes: 60 });
    expect(rebuildMenu).toHaveBeenCalledTimes(1);
  });

  it("settings:set-theme stores it and sets nativeTheme.themeSource before replying", () => {
    expect(run("settings:set-theme", { theme: "dark" })).toEqual({ ok: true, value: null });
    expect(settings.nativeTheme.themeSource).toBe("dark");
    expect(value("theme")).toEqual({ value: '"dark"', updated_at: T });
  });

  it("settings:set-language stores it, recomputes the language, rebuilds the menu once and returns it", () => {
    expect(run("settings:set-language", { setting: "fr" })).toEqual({ ok: true, value: { language: "fr" } });
    expect(value("language").value).toBe('"fr"');
    expect(rebuildMenu).toHaveBeenCalledTimes(1);
  });

  it("settings:set-shortcuts stores valid overrides and rebuilds the menu", () => {
    expect(run("settings:set-shortcuts", { overrides: { undo: ["Mod+U"], newTask: ["Mod+Z"] } })).toEqual({ ok: true, value: null });
    expect(JSON.parse(value("shortcuts").value)).toEqual({ undo: ["Mod+U"], newTask: ["Mod+Z"] });
    expect(rebuildMenu).toHaveBeenCalledTimes(1);
  });

  it("settings:set-shortcuts refuses a map normalization would change", () => {
    for (const overrides of [{ search: ["Mod+N"] }, { newTask: ["Mod+C"] }, { done: ["N"] }]) {
      expect(run("settings:set-shortcuts", { overrides }), JSON.stringify(overrides)).toMatchObject({ ok: false, error: { code: "INVALID" } });
    }
    expect(value("shortcuts").value).toBe("{}");
  });

  it("window:minimize and keys:set-capture call main", () => {
    expect(run("window:minimize", undefined)).toEqual({ ok: true, value: null });
    expect(minimizeWindow).toHaveBeenCalledTimes(1);
    run("keys:set-capture", { on: true });
    run("keys:set-capture", { on: false });
    expect(setCapture.mock.calls).toEqual([[true], [false]]);
  });

  it("with VESTA_FAULT=save, every settings channel fails, logs and leaves the row unchanged", () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    for (const [channel, payload, key] of [
      ["settings:set-alert", { key: "alertPeriodMin", minutes: 120 }, "alertPeriodMin"],
      ["settings:set-theme", { theme: "dark" }, "theme"],
      ["settings:set-language", { setting: "fr" }, "language"],
      ["settings:set-shortcuts", { overrides: { newTask: ["F5"] } }, "shortcuts"],
    ] as const) {
      const before = value(key);
      expect(run(channel, payload), channel).toMatchObject({ ok: false, error: { code: "SAVE_FAILED" } });
      expect(value(key)).toEqual(before);
    }
    expect(log.error).toHaveBeenCalledWith("save.failed", expect.objectContaining({ action: "settings:set-theme" }));
    expect(settings.nativeTheme.themeSource).toBe("system");
  });

  it("FR-016 settings:set-color-lists saves through the repo with the clock and returns null", () => {
    expect(run("settings:set-color-lists", { pinned: ["#000001ff"], recent: ["#000002ff"], pinnedNow: "#000001ff" })).toEqual({ ok: true, value: null });
    expect(value("pinnedColors")).toEqual({ value: JSON.stringify([{ hex: "#000001ff", at: T }]), updated_at: T });
    expect(value("recentColors")).toEqual({ value: '["#000002ff"]', updated_at: T });
  });

  it("FR-020b settings:set-table-rows-first saves the boolean", () => {
    expect(run("settings:set-table-rows-first", { on: true })).toEqual({ ok: true, value: null });
    expect(value("tableRowsFirst")).toEqual({ value: "true", updated_at: T });
  });

  it("FR-016 a failing save maps to SAVE_FAILED", () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    expect(run("settings:set-table-rows-first", { on: true })).toMatchObject({ ok: false, error: { code: "SAVE_FAILED" } });
    expect(run("settings:set-color-lists", { pinned: null, recent: ["#000002ff"], pinnedNow: null })).toMatchObject({
      ok: false,
      error: { code: "SAVE_FAILED" },
    });
  });

  it("FR-016 the initial state carries the editor settings, pinned colors as their hex order", () => {
    db.prepare("update settings set value = ? where key = 'pinnedColors'").run(JSON.stringify([{ hex: "#000003ff", at: 5 }]));
    const r = run("app:get-initial-state", undefined) as { ok: true; value: { pinnedColors: string[]; recentColors: string[]; tableRowsFirst: boolean } };
    expect(r.value.pinnedColors).toEqual(["#000003ff"]);
    expect(r.value.recentColors).toEqual([]);
    expect(r.value.tableRowsFirst).toBe(false);
  });
});

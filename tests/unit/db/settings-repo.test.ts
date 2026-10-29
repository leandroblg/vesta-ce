import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import {
  loadAlertSettings,
  loadLogSettings,
  loadPanelWidth,
  loadUiSettings,
  saveAlertSetting,
  saveAutoUpdateCheck,
  saveLanguage,
  saveLogLevel,
  savePanelWidth,
  saveShortcuts,
  saveTheme,
  saveUpdateNotice,
} from "../../../src/main/db/settings-repo";
import { initFaults } from "../../../src/main/faults";
import { tempDir } from "./helpers";

describe("alert settings repository (003 FR-001)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  const set = (key: string, value: string) => db.prepare("update settings set value = ? where key = ?").run(value, key);

  it("reads the defaults the migration inserted, with no issue", () => {
    expect(loadAlertSettings(db)).toEqual({
      settings: { ...DEFAULT_ALERT_SETTINGS },
      issues: [],
    });
  });

  it("reads stored values", () => {
    set("alertPeriodMin", "2880");
    expect(loadAlertSettings(db).settings.alertPeriodMin).toBe(2880);
  });

  it("uses the default for a deleted row and reports it as missing", () => {
    db.prepare("delete from settings where key = 'alertPeriodMin'").run();
    const r = loadAlertSettings(db);
    expect(r.settings.alertPeriodMin).toBe(1440);
    expect(r.issues).toEqual([{ key: "alertPeriodMin", kind: "missing" }]);
  });

  it("uses the default for an unreadable value", () => {
    set("reblinkIntervalMin", "abc");
    const r = loadAlertSettings(db);
    expect(r.settings.reblinkIntervalMin).toBe(240);
    expect(r.issues).toEqual([{ key: "reblinkIntervalMin", kind: "unreadable" }]);
  });

  it("brings an out-of-range value to the nearest limit", () => {
    set("alertPeriodMin", "30");
    const r = loadAlertSettings(db);
    expect(r.settings.alertPeriodMin).toBe(60);
    expect(r.issues).toEqual([{ key: "alertPeriodMin", kind: "clamped" }]);
  });
});

describe("panel width setting (005 FR-005)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  const set = (value: string) => db.prepare("update settings set value = ? where key = 'panelWidth'").run(value);

  it("reads 420 by default, with no issue", () => {
    expect(loadPanelWidth(db)).toEqual({ px: 420, issue: null });
  });

  it("clamps an out-of-range value and reports it", () => {
    set("100");
    expect(loadPanelWidth(db)).toEqual({ px: 300, issue: "clamped" });
    set("900");
    expect(loadPanelWidth(db)).toEqual({ px: 760, issue: "clamped" });
  });

  it("uses the default for a missing or unreadable value", () => {
    set("wide");
    expect(loadPanelWidth(db)).toEqual({ px: 420, issue: "unreadable" });
    db.prepare("delete from settings where key = 'panelWidth'").run();
    expect(loadPanelWidth(db)).toEqual({ px: 420, issue: "missing" });
  });

  it("stores the integer width with the edit time", () => {
    savePanelWidth(db, 512.4, 777);
    expect(db.prepare("select value, updated_at from settings where key = 'panelWidth'").get()).toEqual({
      value: "512",
      updated_at: 777,
    });
    expect(loadPanelWidth(db)).toEqual({ px: 512, issue: null });
    db.prepare("delete from settings where key = 'panelWidth'").run();
    savePanelWidth(db, 300, 778);
    expect(loadPanelWidth(db)).toEqual({ px: 300, issue: null });
  });
});

describe("theme, language and shortcut settings (007 FR-038, quickstart 25)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  const row = (key: string) => db.prepare("select value, updated_at from settings where key = ?").get(key) as { value: string; updated_at: number };

  it("reads the migration's defaults with no issue", () => {
    expect(loadUiSettings(db, false)).toEqual({ settings: { theme: "system", palette: "hearth", language: "system", shortcuts: {} }, issues: [] });
  });

  it("replaces damaged values by their defaults, entry by entry for the map", () => {
    db.prepare("update settings set value = ? where key = 'theme'").run('"blue"');
    db.prepare("update settings set value = ? where key = 'language'").run('"de"');
    db.prepare("update settings set value = ? where key = 'shortcuts'").run('{"nope":["F5"],"search":["Mod+N"],"edit":["F3"]}');
    const r = loadUiSettings(db, false);
    expect(r.settings).toEqual({ theme: "system", palette: "hearth", language: "system", shortcuts: { edit: ["F3"] } });
    expect(r.issues).toHaveLength(4);
  });

  it("reports missing rows", () => {
    db.prepare("delete from settings where key in ('theme', 'language', 'shortcuts')").run();
    expect(loadUiSettings(db, false).issues.map((i) => i.kind)).toEqual(["missing", "missing", "missing"]);
  });

  it("writes one row per setting, as JSON, with updated_at = now", () => {
    saveAlertSetting(db, "reblinkIntervalMin", 30, 101);
    saveTheme(db, "dark", 102);
    saveLanguage(db, "fr", 103);
    saveShortcuts(db, { newTask: ["F5"] }, 104);
    expect(row("reblinkIntervalMin")).toEqual({ value: "30", updated_at: 101 });
    expect(row("theme")).toEqual({ value: '"dark"', updated_at: 102 });
    expect(row("language")).toEqual({ value: '"fr"', updated_at: 103 });
    expect(row("shortcuts")).toEqual({ value: '{"newTask":["F5"]}', updated_at: 104 });
    saveShortcuts(db, {}, 105);
    expect(row("shortcuts")).toEqual({ value: "{}", updated_at: 105 });
  });

  it("throws when the database cannot be written", () => {
    db.close();
    expect(() => {
      saveTheme(db, "light", 1);
    }).toThrow();
    db = openDatabase(":memory:");
  });
});

describe("log and update settings repository (009 data-model \"Database\")", () => {
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    delete process.env["VESTA_FAULT"];
    initFaults(true);
    db.close();
    cleanup();
  });

  const row = (key: string) => db.prepare("select value, updated_at from settings where key = ?").get(key);

  it("reads the migration's defaults with no issue and no notice", () => {
    expect(loadLogSettings(db)).toEqual({ logLevel: "info", autoUpdateCheck: true, updateNotice: null, updateReminder: true, updateReminderDays: 30, updateReminderAnchor: null, issues: [] });
  });

  it("saves each value as an upsert stamped with its time", () => {
    saveLogLevel(db, "trace", 100);
    saveAutoUpdateCheck(db, false, 200);
    saveUpdateNotice(db, { version: "0.2.0", seen: false }, 300);
    expect(row("logLevel")).toEqual({ value: '"trace"', updated_at: 100 });
    expect(row("autoUpdateCheck")).toEqual({ value: "false", updated_at: 200 });
    expect(row("updateNotice")).toEqual({ value: '{"version":"0.2.0","seen":false}', updated_at: 300 });
    saveUpdateNotice(db, { version: "0.2.0", seen: true }, 400);
    expect(loadLogSettings(db)).toEqual({ logLevel: "trace", autoUpdateCheck: false, updateNotice: { version: "0.2.0", seen: true }, updateReminder: true, updateReminderDays: 30, updateReminderAnchor: null, issues: [] });
  });

  it("fails the two user settings on VESTA_FAULT=save, like the other settings", () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    expect(() => {
      saveLogLevel(db, "debug", 1);
    }).toThrow("VESTA_FAULT=save");
    expect(() => {
      saveAutoUpdateCheck(db, false, 1);
    }).toThrow("VESTA_FAULT=save");
    expect(loadLogSettings(db).logLevel).toBe("info");
  });
});

describe("editor settings repository (011 FR-016, contracts/ipc.md)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    delete process.env["VESTA_FAULT"];
    initFaults(true);
    db.close();
    cleanup();
  });

  const row = (key: string) => db.prepare("select value, updated_at from settings where key = ?").get(key);

  it("FR-016 reads the migration's defaults", async () => {
    const { loadEditorSettings } = await import("../../../src/main/db/settings-repo");
    expect(loadEditorSettings(db)).toEqual({ pinnedColors: [], recentColors: [], tableRowsFirst: false, lastTextColor: "#b9411cff", issues: [] });
  });

  it("016 FR-022 saveLastTextColor writes the Text color swatch with its time; loadEditorSettings reads it back", async () => {
    const { loadEditorSettings, saveLastTextColor } = await import("../../../src/main/db/settings-repo");
    saveLastTextColor(db, "#2563ebff", 700);
    expect(row("lastTextColor")).toEqual({ value: '"#2563ebff"', updated_at: 700 });
    expect(loadEditorSettings(db).lastTextColor).toBe("#2563ebff");
  });

  it("FR-016 saves only the lists present, stamping pin times and cleaning recent colors", async () => {
    const { loadEditorSettings, saveColorLists } = await import("../../../src/main/db/settings-repo");
    saveColorLists(db, { recent: ["#000001ff", "#000002ff"] }, 100);
    expect(row("recentColors")).toEqual({ value: '["#000001ff","#000002ff"]', updated_at: 100 });
    expect(row("pinnedColors")).toEqual({ value: "[]", updated_at: 0 });

    // A pin from the recent list: pinned stamped with now, recent cleaned, both in one write.
    saveColorLists(db, { pinned: ["#000002ff"], recent: ["#000001ff"], pinnedNow: "#000002ff" }, 200);
    expect(loadEditorSettings(db).pinnedColors).toEqual([{ hex: "#000002ff", at: 200 }]);
    expect(row("recentColors")).toEqual({ value: '["#000001ff"]', updated_at: 200 });

    // A reorder keeps the times.
    saveColorLists(db, { pinned: ["#000003ff", "#000002ff"], pinnedNow: "#000003ff" }, 300);
    saveColorLists(db, { pinned: ["#000002ff", "#000003ff"] }, 400);
    expect(loadEditorSettings(db).pinnedColors).toEqual([
      { hex: "#000002ff", at: 200 },
      { hex: "#000003ff", at: 300 },
    ]);
    expect((row("pinnedColors") as { updated_at: number }).updated_at).toBe(400);

    // A recent list sent alone drops colors already pinned and presets.
    saveColorLists(db, { recent: ["#000002ff", "#ef4444ff", "#000009ff"] }, 500);
    expect(loadEditorSettings(db).recentColors).toEqual(["#000009ff"]);
  });

  it("FR-016 saves the rows-first setting", async () => {
    const { loadEditorSettings, saveTableRowsFirst } = await import("../../../src/main/db/settings-repo");
    saveTableRowsFirst(db, true, 700);
    expect(row("tableRowsFirst")).toEqual({ value: "true", updated_at: 700 });
    expect(loadEditorSettings(db).tableRowsFirst).toBe(true);
  });

  it("FR-016 both savers fail on VESTA_FAULT=save; the rewrite flag does not", async () => {
    const { saveColorLists, saveColorsRewritten, loadColorsRewritten, saveTableRowsFirst } = await import(
      "../../../src/main/db/settings-repo"
    );
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    expect(() => {
      saveColorLists(db, { recent: ["#000001ff"] }, 1);
    }).toThrow("VESTA_FAULT=save");
    expect(() => {
      saveTableRowsFirst(db, true, 1);
    }).toThrow("VESTA_FAULT=save");
    expect(loadColorsRewritten(db)).toBe(false);
    saveColorsRewritten(db, 9);
    expect(loadColorsRewritten(db)).toBe(true);
    expect(row("recentColors")).toEqual({ value: "[]", updated_at: 0 });
  });
});

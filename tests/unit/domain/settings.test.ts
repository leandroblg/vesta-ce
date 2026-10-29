import { describe, expect, it } from "vitest";
import { normalizeLogSettings, normalizeUiSettings } from "../../../src/domain/settings";

describe("normalizeUiSettings (007 FR-038, research §7)", () => {
  it("keeps valid rows unchanged", () => {
    const { settings, issues } = normalizeUiSettings(
      { theme: '"dark"', palette: '"ubuntu"', language: '"pt-BR"', shortcuts: '{"newTask":["Mod+Shift+T"]}' },
      false,
    );
    expect(settings).toEqual({ theme: "dark", palette: "ubuntu", language: "pt-BR", shortcuts: { newTask: ["Mod+Shift+T"] } });
    expect(issues).toEqual([]);
  });

  it("replaces a missing or unknown theme and language, one issue each", () => {
    const { settings, issues } = normalizeUiSettings({ theme: '"blue"', palette: '"neon"', language: '"de"' }, false);
    expect(settings.theme).toBe("system");
    expect(settings.palette).toBe("hearth");
    expect(settings.language).toBe("system");
    expect(issues).toEqual(
      expect.arrayContaining([
        { key: "theme", kind: "unreadable" },
        { key: "palette", kind: "unreadable" },
        { key: "language", kind: "unreadable" },
        { key: "shortcuts", kind: "missing" },
      ]),
    );
    expect(normalizeUiSettings({}, false).issues.map((i) => i.key)).toEqual(["theme", "palette", "language", "shortcuts"]);
  });

  it("drops an unreadable map, and damaged entries one by one", () => {
    expect(normalizeUiSettings({ theme: '"system"', palette: '"hearth"', language: '"system"', shortcuts: "{nope" }, false).settings.shortcuts).toEqual({});
    const { settings, issues } = normalizeUiSettings(
      { theme: '"system"', palette: '"hearth"', language: '"system"', shortcuts: '{"nope":["F5"],"search":["Mod+N"],"edit":["F3"]}' },
      false,
    );
    expect(settings.shortcuts).toEqual({ edit: ["F3"] });
    expect(issues).toEqual([
      { key: "shortcuts", kind: "entry", action: "nope" },
      { key: "shortcuts", kind: "entry", action: "search" },
    ]);
  });
});

describe("normalizeLogSettings (009 data-model \"Database\")", () => {
  it("reads the stored log level, automatic check and update notice", () => {
    for (const level of ["fatal", "error", "warn", "info", "debug", "trace"] as const) {
      const r = normalizeLogSettings({ logLevel: JSON.stringify(level), autoUpdateCheck: "false" });
      expect(r.logLevel).toBe(level);
      expect(r.autoUpdateCheck).toBe(false);
    }
    const r = normalizeLogSettings({ logLevel: '"info"', autoUpdateCheck: "true", updateNotice: '{"version":"0.2.0","seen":false}', updateReminder: "true", updateReminderDays: "30" });
    expect(r).toEqual({
      logLevel: "info",
      autoUpdateCheck: true,
      updateNotice: { version: "0.2.0", seen: false },
      updateReminder: true,
      updateReminderDays: 30,
      updateReminderAnchor: null,
      issues: [],
    });
  });

  it("falls back to Info and automatic checks on, one issue per row not used as stored", () => {
    expect(normalizeLogSettings({})).toEqual({
      logLevel: "info",
      autoUpdateCheck: true,
      updateNotice: null,
      updateReminder: true,
      updateReminderDays: 30,
      updateReminderAnchor: null,
      issues: [
        { key: "logLevel", kind: "missing" },
        { key: "autoUpdateCheck", kind: "missing" },
        { key: "updateReminder", kind: "missing" },
        { key: "updateReminderDays", kind: "missing" },
      ],
    });
    const r = normalizeLogSettings({ logLevel: '"warning"', autoUpdateCheck: '"yes"', updateNotice: "{nope", updateReminder: "true", updateReminderDays: "30" });
    expect(r.logLevel).toBe("info");
    expect(r.autoUpdateCheck).toBe(true);
    expect(r.updateNotice).toBeNull();
    expect(r.issues).toEqual([
      { key: "logLevel", kind: "unreadable" },
      { key: "autoUpdateCheck", kind: "unreadable" },
      { key: "updateNotice", kind: "unreadable" },
    ]);
  });

  it("refuses an update notice that is not a version and a seen flag", () => {
    for (const bad of ['{"version":"1.2","seen":false}', '{"version":"0.2.0"}', '{"version":"0.2.0","seen":"no"}', '"0.2.0"']) {
      const r = normalizeLogSettings({ logLevel: '"info"', autoUpdateCheck: "true", updateNotice: bad, updateReminder: "true", updateReminderDays: "30" });
      expect(r.updateNotice, bad).toBeNull();
      expect(r.issues, bad).toEqual([{ key: "updateNotice", kind: "unreadable" }]);
    }
  });
});

describe("Q133 normalizeLogSettings: the update reminder rows (010 data-model 'Settings')", () => {
  const base = { logLevel: '"info"', autoUpdateCheck: "true" };

  it("Q133 defaults to a reminder every 30 days with no anchor when the rows are missing", () => {
    const { logLevel, autoUpdateCheck, updateReminder, updateReminderDays, updateReminderAnchor, issues } = normalizeLogSettings(base);
    expect({ logLevel, autoUpdateCheck, updateReminder, updateReminderDays, updateReminderAnchor }).toEqual({
      logLevel: "info",
      autoUpdateCheck: true,
      updateReminder: true,
      updateReminderDays: 30,
      updateReminderAnchor: null,
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        { key: "updateReminder", kind: "missing" },
        { key: "updateReminderDays", kind: "missing" },
      ]),
    );
    expect(issues.some((i) => i.key === "updateReminderAnchor")).toBe(false);
  });

  it("Q133 keeps valid rows", () => {
    const s = normalizeLogSettings({ ...base, updateReminder: "false", updateReminderDays: "7", updateReminderAnchor: "12345" });
    expect(s.updateReminder).toBe(false);
    expect(s.updateReminderDays).toBe(7);
    expect(s.updateReminderAnchor).toBe(12345);
    expect(s.issues).toEqual([]);
    expect(normalizeLogSettings({ ...base, updateReminder: "true", updateReminderDays: "365" }).updateReminderDays).toBe(365);
  });

  it.each(["6", "366", "30.5", '"30"', "null", "{"])("Q133 replaces the unreadable period %s with 30 and reports it", (raw) => {
    const s = normalizeLogSettings({ ...base, updateReminder: "true", updateReminderDays: raw });
    expect(s.updateReminderDays).toBe(30);
    expect(s.issues).toEqual([{ key: "updateReminderDays", kind: "unreadable" }]);
  });

  it("Q133 replaces an unreadable reminder switch or anchor and reports it", () => {
    const s = normalizeLogSettings({ ...base, updateReminder: '"yes"', updateReminderDays: "30", updateReminderAnchor: '"soon"' });
    expect(s.updateReminder).toBe(true);
    expect(s.updateReminderAnchor).toBeNull();
    expect(s.issues).toEqual(
      expect.arrayContaining([
        { key: "updateReminder", kind: "unreadable" },
        { key: "updateReminderAnchor", kind: "unreadable" },
      ]),
    );
  });
});

describe("FR-016 editor settings (011 data-model \"Database\")", () => {
  it("FR-016 passes valid rows through", async () => {
    const { normalizeEditorSettings } = await import("../../../src/domain/settings");
    const r = normalizeEditorSettings({
      pinnedColors: JSON.stringify([{ hex: "#ffe066ff", at: 5 }]),
      recentColors: JSON.stringify(["#dd3333ff"]),
      tableRowsFirst: "true",
    });
    expect(r).toEqual({
      pinnedColors: [{ hex: "#ffe066ff", at: 5 }],
      recentColors: ["#dd3333ff"],
      tableRowsFirst: true,
      lastTextColor: "#b9411cff",
      issues: [],
    });
  });

  it("016 FR-022 lastTextColor is an 8-digit hex color; a missing one is the Hearth ember, an invalid one too, reported", async () => {
    const { normalizeEditorSettings } = await import("../../../src/domain/settings");
    expect(normalizeEditorSettings({ lastTextColor: JSON.stringify("#2563ebff") }).lastTextColor).toBe("#2563ebff");
    const missing = normalizeEditorSettings({});
    expect(missing.lastTextColor).toBe("#b9411cff");
    expect(missing.issues.some((i) => i.key === "lastTextColor")).toBe(false);
    for (const bad of ['"#2563eb"', '"blue"', "12", '"#2563EBFF"']) {
      const r = normalizeEditorSettings({ lastTextColor: bad });
      expect(r.lastTextColor, bad).toBe("#b9411cff");
      expect(r.issues, bad).toContainEqual({ key: "lastTextColor", kind: "unreadable" });
    }
  });

  it("FR-016 a missing row gives the default and a missing issue", async () => {
    const { normalizeEditorSettings } = await import("../../../src/domain/settings");
    const r = normalizeEditorSettings({});
    expect(r.pinnedColors).toEqual([]);
    expect(r.recentColors).toEqual([]);
    expect(r.tableRowsFirst).toBe(false);
    expect(r.issues).toEqual([
      { key: "pinnedColors", kind: "missing" },
      { key: "recentColors", kind: "missing" },
      { key: "tableRowsFirst", kind: "missing" },
    ]);
  });

  it("FR-016 an unreadable or invalid value gives the default and an unreadable issue", async () => {
    const { normalizeEditorSettings } = await import("../../../src/domain/settings");
    const eleven = Array.from({ length: 11 }, (_, i) => ({ hex: `#0000${i.toString(16).padStart(2, "0")}ff`, at: 1 }));
    const r = normalizeEditorSettings({
      pinnedColors: JSON.stringify(eleven),
      recentColors: JSON.stringify(["#ffe066"]),
      tableRowsFirst: "{not json",
    });
    expect(r.pinnedColors).toEqual([]);
    expect(r.recentColors).toEqual([]);
    expect(r.tableRowsFirst).toBe(false);
    expect(r.issues).toEqual([
      { key: "pinnedColors", kind: "unreadable" },
      { key: "recentColors", kind: "unreadable" },
      { key: "tableRowsFirst", kind: "unreadable" },
    ]);
  });
});

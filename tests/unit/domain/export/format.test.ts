// T003: the export file's writer side (contracts/export-format.md, data-model "Domain types"; FR-012, FR-016).
import { describe, expect, it } from "vitest";
import {
  EXPORTED_SETTING_KEYS,
  EXPORT_FORMAT,
  FORMAT_VERSION,
  MAX_DATA_JSON_BYTES,
  REMINDER_FIELDS,
  TASK_FIELDS,
  toExportJson,
  type ExportData,
} from "../../../../src/domain/export/format";
import { mk, mkReminder } from "../fixtures";

function sample(overrides: Partial<ExportData> = {}): ExportData {
  return {
    appVersion: "0.8.0",
    exportedAt: 1_792_400_000_000,
    tasks: [mk({ titleMd: "**Ship** export", detailsMd: "![c.png](assets/" + "a".repeat(64) + ".png)" })],
    reminders: [mkReminder({ textMd: "Call the bank" })],
    settings: [
      { key: "alertPeriodMin", value: 1440, updatedAt: 0 },
      { key: "theme", value: "dark", updatedAt: 5 },
      { key: "shortcuts", value: { newTask: ["Mod+Alt+N"] }, updatedAt: 6 },
    ],
    assets: [{ sha256: "a".repeat(64), ext: "png", mimeType: "image/png", size: 10 }],
    ...overrides,
  };
}

describe("export format constants", () => {
  it("names the format, its version and the exported settings", () => {
    expect(EXPORT_FORMAT).toBe("vesta-export");
    expect(FORMAT_VERSION).toBe(1);
    expect([...EXPORTED_SETTING_KEYS]).toEqual([
      "alertPeriodMin",
      "reblinkIntervalMin",
      "rescheduleToleranceMin",
      "quickReschedule1Min",
      "quickReschedule2Min",
      "quickReschedule3Min",
      "quickReschedule4Min",
      "theme",
      "language",
      "shortcuts",
      "panelWidth",
      "remindersCollapsed",
      "logLevel",
      "autoUpdateCheck",
      "updateReminder",
      "updateReminderDays",
      "pinnedColors",
      "recentColors",
      "tableRowsFirst",
      "lastTextColor",
      "palette",
      "archiveCleanupOn",
      "archiveCleanupHours",
      "trashCleanupOn",
      "trashCleanupHours",
    ]);
    // 018: the cleanups' change times are local state.
    expect(EXPORTED_SETTING_KEYS as readonly string[]).not.toContain("archiveCleanupChangedAt");
    expect(EXPORTED_SETTING_KEYS as readonly string[]).not.toContain("trashCleanupChangedAt");
    expect(EXPORTED_SETTING_KEYS as readonly string[]).not.toContain("colorsRewritten");
    expect(EXPORTED_SETTING_KEYS as readonly string[]).not.toContain("updateNotice");
    expect(MAX_DATA_JSON_BYTES).toBe(64 * 1024 * 1024); // 010 L10
  });

  it("lists every Task and Reminder field (FR-012)", () => {
    expect([...TASK_FIELDS].sort()).toEqual(Object.keys(mk()).sort());
    expect([...REMINDER_FIELDS].sort()).toEqual(Object.keys(mkReminder()).sort());
  });
});

describe("toExportJson", () => {
  it("writes the header first, then tasks, their history events (015), reminders, settings and assets", () => {
    const parsed = JSON.parse(toExportJson(sample())) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "format",
      "formatVersion",
      "appVersion",
      "exportedAt",
      "tasks",
      "taskEvents",
      "reminders",
      "settings",
      "assets",
    ]);
    expect(parsed["format"]).toBe("vesta-export");
    expect(parsed["formatVersion"]).toBe(1);
  });

  it("writes every field of every item under its domain name", () => {
    const data = sample();
    const parsed = JSON.parse(toExportJson(data)) as ExportData;
    expect(parsed.tasks).toEqual(data.tasks);
    expect(parsed.reminders).toEqual(data.reminders);
    expect(parsed.settings).toEqual(data.settings);
    expect(parsed.assets).toEqual(data.assets);
    expect(Object.keys(parsed.tasks[0] ?? {})).toEqual([...TASK_FIELDS]);
  });

  it("keeps every character the editors accept byte for byte (FR-012)", () => {
    const text = "line\r\nnext 🎉🧑‍🚀 שלום مرحبا\n```\n\u0000\u0001\u001f\t\\ \"q\"\n```\n   lone \\";
    const data = sample({ tasks: [mk({ titleMd: text, detailsMd: text })], reminders: [mkReminder({ textMd: text })] });
    const parsed = JSON.parse(toExportJson(data)) as ExportData;
    expect(parsed.tasks[0]?.titleMd).toBe(text);
    expect(parsed.tasks[0]?.detailsMd).toBe(text);
    expect(parsed.reminders[0]?.textMd).toBe(text);
  });
});

// 011 FR-022b: the panel follows its task only while the task belongs to the view it was opened in.
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { fitsView } from "../../../src/renderer/store/panel-view";
import { planReplace } from "../../../src/renderer/store/replace-data";
import { mk } from "../domain/fixtures";

describe("FR-022b the panel's view", () => {
  it("FR-022b the panel stays open for an archived task in the Archive view and closes when it is restored or deleted forever", () => {
    const done = mk({ doneAt: 10 });
    expect(fitsView(done, "archive")).toBe(true);
    expect(fitsView({ ...done, doneAt: null }, "archive")).toBe(false); // restored
    expect(fitsView({ ...done, deletedAt: 20 }, "archive")).toBe(false);
    expect(fitsView(mk({ deletedAt: 30 }), "trash")).toBe(true);
    expect(fitsView(mk({ deletedAt: null }), "trash")).toBe(false);
  });

  it("005 FR-004 an active task's panel still closes when it is marked done", () => {
    expect(fitsView(mk(), "tasks")).toBe(true);
    expect(fitsView(mk({ doneAt: 1 }), "tasks")).toBe(false);
  });

  it("FR-022b after an import, an Archive panel stays on a task still done; a main-view panel needs it active", () => {
    const done = mk({ doneAt: 10 });
    const snap = { tasks: [done], reminders: [], remindersCollapsed: false, now: 1, alertSettings: { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 1, reblinkIntervalMin: 1, rescheduleToleranceMin: 1 }, panelWidth: 400, theme: "system" as const, palette: "hearth" as const, languageSetting: "en" as const, language: "en" as const, shortcuts: {}, logLevel: "info" as const, autoUpdateCheck: true, updateReminder: true, updateReminderDays: 30, pinnedColors: [], recentColors: [], tableRowsFirst: false, lastTextColor: "#b9411cff", cleanup: { archive: { on: true, hours: 87_600, remainingMs: null }, trash: { on: true, hours: 720, remainingMs: null } } };
    const base = { overrideFor: null, editingKey: null, menuFor: null, searchActive: false };
    expect(planReplace({ ...base, panelFor: done.id, view: "archive" }, snap).patch.panelFor).toBe(done.id);
    expect(planReplace({ ...base, panelFor: done.id, view: "tasks" }, snap).patch.panelFor).toBeNull();
  });
});

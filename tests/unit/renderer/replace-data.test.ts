// T030: replacing the renderer's data after an import or Undo import (008 FR-040, research §8).
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import type { DataSnapshot } from "../../../src/shared/ipc-contract";
import { planReplace, type ReplaceInput } from "../../../src/renderer/store/replace-data";
import { mk, mkReminder } from "../domain/fixtures";

function snapshot(over: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    tasks: [],
    reminders: [],
    remindersCollapsed: false,
    now: 5,
    alertSettings: { ...DEFAULT_ALERT_SETTINGS, alertPeriodMin: 120 },
    panelWidth: 500,
    theme: "dark",
    palette: "minimal",
    languageSetting: "it",
    language: "it",
    shortcuts: { newTask: ["Mod+Alt+N"] },
    logLevel: "info",
    autoUpdateCheck: true, updateReminder: true, updateReminderDays: 30,
    pinnedColors: [], recentColors: [], tableRowsFirst: false, lastTextColor: "#b9411cff",
    cleanup: { archive: { on: true, hours: 87_600, remainingMs: null }, trash: { on: true, hours: 720, remainingMs: null } },
    ...over,
  };
}

const state = (over: Partial<ReplaceInput> = {}): ReplaceInput => ({
  panelFor: null,
  overrideFor: null,
  editingKey: null,
  menuFor: null,
  searchActive: false,
  ...over,
});

describe("planReplace", () => {
  it("replaces every row and setting in one patch", () => {
    const t = mk();
    const r = mkReminder();
    const { patch } = planReplace(state(), snapshot({ tasks: [t], reminders: [r], remindersCollapsed: true }));
    expect(patch.tasks).toEqual({ [t.id]: t });
    expect(patch.reminders).toEqual({ [r.id]: r });
    expect(patch).toMatchObject({
      remindersCollapsed: true,
      now: 5,
      panelWidth: 500,
      theme: "dark",
      palette: "minimal",
      languageSetting: "it",
      shortcuts: { newTask: ["Mod+Alt+N"] },
      alertSettings: { alertPeriodMin: 120 },
    });
  });

  it("keeps the details panel on a task that is still active, and closes it otherwise", () => {
    const t = mk();
    expect(planReplace(state({ panelFor: t.id }), snapshot({ tasks: [t] })).patch.panelFor).toBe(t.id);
    expect(planReplace(state({ panelFor: t.id }), snapshot({ tasks: [{ ...t, doneAt: 9 }] })).patch.panelFor).toBeNull();
    expect(planReplace(state({ panelFor: t.id }), snapshot()).patch.panelFor).toBeNull();
  });

  it("closes the override panel, an inline edit and a menu whose item is gone or inactive", () => {
    const t = mk();
    const kept = planReplace(state({ overrideFor: t.id, editingKey: t.id, menuFor: t.id }), snapshot({ tasks: [t] })).patch;
    expect(kept).toMatchObject({ overrideFor: t.id, editingKey: t.id, menuFor: t.id });
    const gone = planReplace(state({ overrideFor: t.id, editingKey: t.id, menuFor: t.id }), snapshot()).patch;
    expect(gone).toMatchObject({ overrideFor: null, editingKey: null, menuFor: null });
  });

  it("asks to re-run the search only when one is active", () => {
    expect(planReplace(state({ searchActive: true }), snapshot()).requery).toBe(true);
    expect(planReplace(state(), snapshot()).requery).toBe(false);
  });

  it("returns the language to apply", () => {
    expect(planReplace(state(), snapshot({ language: "fr" })).language).toBe("fr");
  });

  it("FR-016 copies the 011 editor settings after an import", () => {
    const { patch } = planReplace(state(), snapshot({ pinnedColors: ["#000001ff"], recentColors: ["#000002ff"], tableRowsFirst: true }));
    expect(patch.pinnedColors).toEqual(["#000001ff"]);
    expect(patch.recentColors).toEqual(["#000002ff"]);
    expect(patch.tableRowsFirst).toBe(true);
  });
});

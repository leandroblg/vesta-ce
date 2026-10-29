// T050 (008 FR-032, PRD A7): every action that is an edit sets the last-edit time, so the newest action wins a
// merge; collapsing is not an edit (001 FR-016).
import { describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { create, editDetails, editTitle, markDone, remove, reschedule, restore, setAlertOverride, setCollapsed } from "../../../src/domain/actions";
import { moveTask } from "../../../src/domain/move";
import {
  createReminder,
  editReminderText,
  markReminderDone,
  moveReminder,
  removeReminder,
  restoreReminder,
  setRemindersCollapsed,
} from "../../../src/domain/reminder-actions";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { idGen, mk, mkReminder } from "./fixtures";

const NOW = 9_000_000;
const clock = fixedClock(NOW);
const touched = (rows: readonly { id: string; updatedAt: number }[], id: string) => rows.find((r) => r.id === id)?.updatedAt;

describe("tasks: every edit sets updatedAt to now", () => {
  const a = mk({ updatedAt: 1 });
  const b = mk({ updatedAt: 1 });
  const sub = mk({ parentId: a.id, updatedAt: 1, position: 1 });
  const tasks = [a, b, sub];

  it.each([
    ["create", () => create({ title: "New", parentId: null }, tasks, clock, idGen(900)).upserts, "00000000-0000-4000-8000-000000000384"],
    ["edit title", () => editTitle(a.id, "Renamed", tasks, clock).upserts, a.id],
    ["edit details", () => editDetails(a.id, "Details", tasks, clock).upserts, a.id],
    ["mark done", () => markDone(a.id, tasks, clock).upserts, a.id],
    ["delete", () => remove(a.id, tasks, clock).upserts, a.id],
    ["reschedule", () => reschedule(b.id, [a, { ...b, staleSince: 10, wasStale: true }, sub], clock, DEFAULT_ALERT_SETTINGS).upserts, b.id],
    ["alert override", () => setAlertOverride(a.id, 120, tasks, clock).upserts, a.id],
    ["move (reorder)", () => moveTask(b.id, { kind: "top", beforeId: a.id }, tasks, clock, DEFAULT_ALERT_SETTINGS).upserts, b.id],
    ["move (demote)", () => moveTask(b.id, { kind: "sub", parentId: a.id, beforeId: null }, tasks, clock, DEFAULT_ALERT_SETTINGS).upserts, b.id],
    ["move (promote)", () => moveTask(sub.id, { kind: "top", beforeId: null }, tasks, clock, DEFAULT_ALERT_SETTINGS).upserts, sub.id],
  ] as const)("%s", (_name, run, id) => {
    expect(touched(run(), id)).toBe(NOW);
  });

  it("restore", () => {
    const done = { ...a, doneAt: 5 };
    expect(touched(restore(a.id, [done, b], clock).upserts, a.id)).toBe(NOW);
  });

  it("collapse is not an edit", () => {
    const { upserts } = setCollapsed(a.id, true, tasks);
    expect(touched(upserts, a.id)).toBe(1);
  });
});

describe("reminders: every edit sets updatedAt to now", () => {
  const r = mkReminder({ updatedAt: 1 });
  const s = mkReminder({ updatedAt: 1 });
  const rows = [r, s];

  it.each([
    ["create", () => createReminder({ text: "New" }, rows, clock, idGen(950)).upserts, "00000000-0000-4000-8000-0000000003b6"],
    ["edit text", () => editReminderText(r.id, "Changed", rows, clock).upserts, r.id],
    ["mark done", () => markReminderDone(r.id, rows, clock).upserts, r.id],
    ["delete", () => removeReminder(r.id, rows, clock).upserts, r.id],
    ["restore", () => restoreReminder(r.id, [{ ...r, doneAt: 5 }, s], false, clock).upserts, r.id],
    ["move", () => moveReminder(s.id, r.id, rows, clock).upserts, s.id],
  ] as const)("%s", (_name, run, id) => {
    expect(touched(run(), id)).toBe(NOW);
  });

  it("collapsing the section changes no reminder", () => {
    expect(setRemindersCollapsed(true, false).upserts).toEqual([]);
  });
});

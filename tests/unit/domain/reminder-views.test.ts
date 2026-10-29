import { describe, expect, it } from "vitest";
import { MAX_ACTIVE_REMINDERS } from "../../../src/domain/reminder";
import { activeReminders, atReminderLimit, reminderArchive, reminderCounts, reminderTrash } from "../../../src/domain/reminder-views";
import { mkReminder } from "./fixtures";

describe("activeReminders (FR-002)", () => {
  it("lists active reminders by position, ties by creation time, without done or deleted ones", () => {
    const c = mkReminder({ position: 3 });
    const a = mkReminder({ position: 1 });
    const b2 = mkReminder({ position: 2, createdAt: 20 });
    const b1 = mkReminder({ position: 2, createdAt: 10 });
    const done = mkReminder({ position: 0, doneAt: 5 });
    const deleted = mkReminder({ position: 0, deletedAt: 5 });
    expect(activeReminders([c, done, b2, a, deleted, b1]).map((r) => r.id)).toEqual([a.id, b1.id, b2.id, c.id]);
  });
});

describe("atReminderLimit (FR-007a)", () => {
  it("is true at 200 or more active reminders and ignores done and deleted ones", () => {
    const active = Array.from({ length: MAX_ACTIVE_REMINDERS - 1 }, () => mkReminder());
    expect(atReminderLimit([...active, mkReminder({ doneAt: 1 }), mkReminder({ deletedAt: 1 })])).toBe(false);
    expect(atReminderLimit([...active, mkReminder()])).toBe(true);
    expect(atReminderLimit([...active, mkReminder(), mkReminder()])).toBe(true);
  });
});

describe("Archive and Trash divisions (FR-016, FR-020)", () => {
  const active = mkReminder();
  const doneOld = mkReminder({ doneAt: 10 });
  const doneNew = mkReminder({ doneAt: 30 });
  const delOld = mkReminder({ deletedAt: 5 });
  const delNew = mkReminder({ deletedAt: 40 });
  const rows = [doneOld, active, delOld, doneNew, delNew];

  it("lists done reminders newest first", () => {
    expect(reminderArchive(rows).map((r) => r.id)).toEqual([doneNew.id, doneOld.id]);
  });

  it("lists deleted reminders newest first", () => {
    expect(reminderTrash(rows).map((r) => r.id)).toEqual([delNew.id, delOld.id]);
  });

  it("counts the reminders each view holds", () => {
    expect(reminderCounts(rows)).toEqual({ archive: 2, trash: 2 });
  });
});


describe("equal positions (008 FR-036)", () => {
  it("orders reminders with equal position and creation time by id", () => {
    const b = mkReminder({ id: "r-b", position: 1, createdAt: 100 });
    const a = mkReminder({ id: "r-a", position: 1, createdAt: 100 });
    expect(activeReminders([b, a]).map((r) => r.id)).toEqual(["r-a", "r-b"]);
  });
});

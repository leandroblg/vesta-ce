import { describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { editReminderText, removeReminder } from "../../../src/domain/reminder-actions";
import { DomainError } from "../../../src/domain/task";
import { id, mkReminder } from "./fixtures";

const clock = fixedClock(700);

describe("editReminderText (FR-010)", () => {
  it("saves normalized text with the new last-edit time", () => {
    const r = mkReminder({ textMd: "Old" });
    expect(editReminderText(r.id, " New\ntext ", [r], clock)).toEqual({
      upserts: [{ ...r, textMd: "New text", updatedAt: 700 }],
      removals: [],
      sectionCollapsed: null,
    });
  });

  it("saves nothing for empty or unchanged text (the last saved text stays)", () => {
    const r = mkReminder({ textMd: "Same" });
    const empty = { upserts: [], removals: [], sectionCollapsed: null };
    expect(editReminderText(r.id, "   ", [r], clock)).toEqual(empty);
    expect(editReminderText(r.id, " Same ", [r], clock)).toEqual(empty);
  });

  it("refuses done or deleted reminders and unknown ids", () => {
    const done = mkReminder({ doneAt: 1 });
    const deleted = mkReminder({ deletedAt: 1 });
    expect(() => editReminderText(done.id, "x", [done], clock)).toThrow(DomainError);
    expect(() => editReminderText(deleted.id, "x", [deleted], clock)).toThrow(DomainError);
    expect(() => editReminderText(id(999), "x", [], clock)).toThrow(/not found/);
  });
});

describe("removeReminder (FR-012, FR-013)", () => {
  it("moves the reminder to the Trash with its neighbours among the active reminders", () => {
    const a = mkReminder({ position: 1 });
    const gone = mkReminder({ position: 1.5, doneAt: 1 });
    const b = mkReminder({ position: 2 });
    const c = mkReminder({ position: 3 });
    const cs = removeReminder(b.id, [c, gone, b, a], clock);
    expect(cs).toEqual({
      upserts: [{ ...b, deletedAt: 700, updatedAt: 700, prevSiblingId: a.id, nextSiblingId: c.id }],
      removals: [],
      sectionCollapsed: null,
    });
  });

  it("has null neighbours at the ends", () => {
    const a = mkReminder({ position: 1 });
    expect(removeReminder(a.id, [a], clock).upserts[0]).toMatchObject({ prevSiblingId: null, nextSiblingId: null });
  });

  it("refuses a reminder that is not active", () => {
    const done = mkReminder({ doneAt: 1 });
    expect(() => removeReminder(done.id, [done], clock)).toThrow(DomainError);
  });
});

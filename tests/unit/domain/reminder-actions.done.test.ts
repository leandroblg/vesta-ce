import { describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { markReminderDone } from "../../../src/domain/reminder-actions";
import { DomainError } from "../../../src/domain/task";
import { mkReminder } from "./fixtures";

const clock = fixedClock(800);

describe("markReminderDone (FR-011, FR-013)", () => {
  it("moves the reminder to the Archive with its neighbours; only that row changes", () => {
    const a = mkReminder({ position: 1 });
    const b = mkReminder({ position: 2 });
    const c = mkReminder({ position: 3 });
    expect(markReminderDone(b.id, [a, b, c], clock)).toEqual({
      upserts: [{ ...b, doneAt: 800, updatedAt: 800, prevSiblingId: a.id, nextSiblingId: c.id }],
      removals: [],
      sectionCollapsed: null,
    });
  });

  it("refuses a reminder that is not active", () => {
    const deleted = mkReminder({ deletedAt: 1 });
    expect(() => markReminderDone(deleted.id, [deleted], clock)).toThrow(DomainError);
  });
});

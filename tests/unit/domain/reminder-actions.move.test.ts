/** moveReminder (004 FR-017, FR-020). */
import { describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { moveReminder } from "../../../src/domain/reminder-actions";
import type { Reminder, ReminderChangeSet } from "../../../src/domain/reminder";
import { activeReminders } from "../../../src/domain/reminder-views";
import { DomainError } from "../../../src/domain/task";
import { mkReminder } from "./fixtures";

const NOW = 1_000_000_000_000;
const clock = fixedClock(NOW);
const empty = { upserts: [], removals: [], sectionCollapsed: null };

function apply(rows: readonly Reminder[], cs: ReminderChangeSet): Reminder[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const u of cs.upserts) byId.set(u.id, u);
  return [...byId.values()];
}
const texts = (rows: readonly Reminder[]) => activeReminders(rows).map((r) => r.textMd);

describe("moveReminder", () => {
  it("reorders among active reminders: R3 before R1 gives R3, R1, R2; only R3 changes", () => {
    const [r1, r2, r3] = [mkReminder({ textMd: "R1", position: 1 }), mkReminder({ textMd: "R2", position: 2 }), mkReminder({ textMd: "R3", position: 3 })];
    const rows = [r1, r2, r3];
    const cs = moveReminder(r3.id, r1.id, rows, clock);
    expect(texts(apply(rows, cs))).toEqual(["R3", "R1", "R2"]);
    expect(cs.upserts).toHaveLength(1);
    expect(cs.upserts[0]).toMatchObject({ id: r3.id, position: 0, updatedAt: NOW, createdAt: r3.createdAt, textMd: "R3" });
    expect(cs.sectionCollapsed).toBeNull();
  });

  it("moves a reminder to the end with beforeId null", () => {
    const [r1, r2] = [mkReminder({ textMd: "R1", position: 1 }), mkReminder({ textMd: "R2", position: 2 })];
    expect(texts(apply([r1, r2], moveReminder(r1.id, null, [r1, r2], clock)))).toEqual(["R2", "R1"]);
  });

  it("a move to its own place changes nothing", () => {
    const [r1, r2, r3] = [mkReminder({ position: 1 }), mkReminder({ position: 2 }), mkReminder({ position: 3 })];
    expect(moveReminder(r2.id, r3.id, [r1, r2, r3], clock)).toEqual(empty);
    expect(moveReminder(r3.id, null, [r1, r2, r3], clock)).toEqual(empty);
  });

  it("renumbers under a 1e-9 gap, keeping the siblings' updatedAt", () => {
    const [r1, r2, r3] = [mkReminder({ position: 1 }), mkReminder({ position: 1 + 5e-10 }), mkReminder({ position: 3 })];
    const cs = moveReminder(r3.id, r2.id, [r1, r2, r3], clock);
    const byId = new Map(cs.upserts.map((r) => [r.id, r]));
    expect(byId.get(r1.id)).toMatchObject({ position: 1, updatedAt: r1.updatedAt });
    expect(byId.get(r2.id)).toMatchObject({ position: 3, updatedAt: r2.updatedAt });
    expect(byId.get(r3.id)).toMatchObject({ position: 2, updatedAt: NOW });
  });

  it("refuses an unknown id, an inactive reminder and a beforeId that is not another active reminder", () => {
    const [r1, r2] = [mkReminder({ position: 1 }), mkReminder({ position: 2 })];
    const done = mkReminder({ position: 3, doneAt: NOW - 1 });
    const rows = [r1, r2, done];
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof DomainError ? e.code : "other";
      }
      return "none";
    };
    expect(code(() => moveReminder("00000000-0000-4000-8000-00000000ffff", null, rows, clock))).toBe("NOT_FOUND");
    expect(code(() => moveReminder(done.id, null, rows, clock))).toBe("INVALID");
    expect(code(() => moveReminder(r1.id, done.id, rows, clock))).toBe("INVALID");
    expect(code(() => moveReminder(r1.id, r1.id, rows, clock))).toBe("INVALID");
  });
});

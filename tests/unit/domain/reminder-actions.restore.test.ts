import { describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { deleteReminderPermanently, restoreReminder } from "../../../src/domain/reminder-actions";
import { DomainError } from "../../../src/domain/task";
import { mkReminder } from "./fixtures";

const clock = fixedClock(900);

describe("restoreReminder (FR-017, FR-018, FR-007a)", () => {
  it("returns it after its former previous neighbour, keeping its creation date", () => {
    const a = mkReminder({ position: 1 });
    const c = mkReminder({ position: 2 });
    const b = mkReminder({ position: 9, createdAt: 42, doneAt: 5, prevSiblingId: a.id, nextSiblingId: c.id });
    const cs = restoreReminder(b.id, [a, b, c], false, clock);
    expect(cs.upserts[0]).toEqual({ ...b, position: 1.5, createdAt: 42, doneAt: null, deletedAt: null, prevSiblingId: null, nextSiblingId: null, updatedAt: 900 });
  });

  it("otherwise before its former next neighbour, otherwise at the end", () => {
    const x = mkReminder({ position: 1 });
    const c = mkReminder({ position: 3 });
    const b = mkReminder({ deletedAt: 5, prevSiblingId: "gone", nextSiblingId: c.id });
    expect(restoreReminder(b.id, [x, c, b], false, clock).upserts[0]?.position).toBe(2);
    const lone = mkReminder({ deletedAt: 5, prevSiblingId: "gone", nextSiblingId: "gone too" });
    expect(restoreReminder(lone.id, [x, c, lone], false, clock).upserts[0]?.position).toBe(4);
  });

  it("expands a collapsed section in the same change set, and leaves an expanded one alone (FR-018)", () => {
    const b = mkReminder({ doneAt: 5 });
    expect(restoreReminder(b.id, [b], true, clock).sectionCollapsed).toBe(false);
    expect(restoreReminder(b.id, [b], false, clock).sectionCollapsed).toBeNull();
  });

  it("is never refused by the 200 limit (FR-007a)", () => {
    const active = Array.from({ length: 200 }, () => mkReminder());
    const b = mkReminder({ doneAt: 5 });
    expect(restoreReminder(b.id, [...active, b], false, clock).upserts[0]?.doneAt).toBeNull();
  });

  it("refuses an active reminder", () => {
    const a = mkReminder();
    expect(() => restoreReminder(a.id, [a], false, clock)).toThrow(DomainError);
  });
});

describe("deleteReminderPermanently (FR-016)", () => {
  it("removes a reminder that is in the Trash", () => {
    const b = mkReminder({ deletedAt: 5 });
    expect(deleteReminderPermanently(b.id, [b])).toEqual({ upserts: [], removals: [b.id], sectionCollapsed: null });
  });

  it("refuses a done or active reminder", () => {
    const done = mkReminder({ doneAt: 5 });
    const active = mkReminder();
    expect(() => deleteReminderPermanently(done.id, [done])).toThrow(DomainError);
    expect(() => deleteReminderPermanently(active.id, [active])).toThrow(DomainError);
  });
});

describe("018 restoreReminder back to the Archive (FR-012, PRD Q281)", () => {
  it("a Trash reminder with keptDoneAt returns to the Archive with that completion date", () => {
    const r = mkReminder({ deletedAt: 800, keptDoneAt: 300 });
    const cs = restoreReminder(r.id, [r], true, clock);
    expect(cs).toEqual({ upserts: [{ ...r, deletedAt: null, doneAt: 300, keptDoneAt: null, updatedAt: 900 }], removals: [], sectionCollapsed: null });
  });
});

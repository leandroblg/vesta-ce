// 018 US4 (FR-014 to FR-020d, FR-016a, FR-017a; PRD Q273, Q277–Q283, Q287; research §5, data-model.md "Cleanup
// rules"): the two automatic cleanups' pure rules.
import { describe, expect, it } from "vitest";
import {
  CLEANUP_LIMITS,
  DEFAULT_CLEANUP,
  HOUR_MS,
  UNDO_WINDOW_MS,
  clampCleanupField,
  changedCleanups,
  cleanupActive,
  joinHours,
  keepsMore,
  needsConfirm,
  selectArchiveExpired,
  selectArchiveExpiredReminders,
  selectTrashExpired,
  selectTrashExpiredReminders,
  splitHours,
  timeLeft,
  validCleanup,
  wouldRemove,
} from "../../../src/domain/cleanup";
import { mk, mkReminder } from "./fixtures";

const HOUR = 3_600_000;
const now = 1_000_000_000_000;
const ago = (h: number, ms = 0) => now - h * HOUR + ms;
const old = now - 100 * HOUR;

describe("limits, split and join (FR-014, FR-015, FR-020)", () => {
  it("names the field ranges and the totals", () => {
    expect(HOUR_MS).toBe(HOUR);
    expect(CLEANUP_LIMITS).toEqual({ years: { min: 0, max: 1000 }, days: { min: 0, max: 364 }, hours: { min: 0, max: 23 }, minTotalHours: 1, maxTotalHours: 8_768_759 });
    expect(joinHours({ years: 1000, days: 364, hours: 23 })).toBe(8_768_759);
    expect(DEFAULT_CLEANUP).toEqual({ archive: { on: true, hours: 87_600 }, trash: { on: true, hours: 720 } });
  });

  it("splits hours into years of 8760 hours, days of 24 and hours, with no calendar arithmetic", () => {
    expect(splitHours(87_600)).toEqual({ years: 10, days: 0, hours: 0 });
    expect(splitHours(720)).toEqual({ years: 0, days: 30, hours: 0 });
    expect(splitHours(8760 + 2 * 24 + 3)).toEqual({ years: 1, days: 2, hours: 3 });
    for (const h of [1, 23, 24, 8759, 8760, 87_600, 8_768_759]) expect(joinHours(splitHours(h))).toBe(h);
  });

  it("clamps a field above its maximum to it (Q237) and below zero to zero", () => {
    expect(clampCleanupField("years", 1001)).toBe(1000);
    expect(clampCleanupField("days", 365)).toBe(364);
    expect(clampCleanupField("hours", 24)).toBe(23);
    expect(clampCleanupField("hours", -3)).toBe(0);
    expect(clampCleanupField("days", 12)).toBe(12);
  });

  it("refuses a zero total and accepts one hour", () => {
    expect(validCleanup({ years: 0, days: 0, hours: 0 })).toBe("min");
    expect(validCleanup({ years: 0, days: 0, hours: 1 })).toBe(1);
    expect(validCleanup({ years: 10, days: 0, hours: 0 })).toBe(87_600);
  });
});

describe("selectArchiveExpired (FR-017, FR-017a)", () => {
  it("selects a top row done exactly the time ago, not one a millisecond younger", () => {
    const a = mk({ doneAt: ago(5), updatedAt: old });
    const b = mk({ doneAt: ago(5, 1), updatedAt: old });
    expect(selectArchiveExpired([a, b], now, 5)).toEqual([a.id]);
  });

  it("takes the subtasks that went with it and judges a lone done subtask by its own date", () => {
    const p = mk({ doneAt: ago(10), updatedAt: old });
    const s = mk({ parentId: p.id, doneAt: ago(10), leftWithId: p.id, updatedAt: old });
    const host = mk({ updatedAt: old });
    const loneOld = mk({ parentId: host.id, doneAt: ago(9), updatedAt: old });
    const loneNew = mk({ parentId: host.id, doneAt: ago(1), updatedAt: old });
    expect(selectArchiveExpired([p, s, host, loneOld, loneNew], now, 5).sort()).toEqual([p.id, s.id, loneOld.id].sort());
  });

  it("never selects an active row or a Trash row, even with an old keptDoneAt", () => {
    const active = mk({ updatedAt: old });
    const trash = mk({ deletedAt: ago(1), keptDoneAt: ago(99), updatedAt: old });
    expect(selectArchiveExpired([active, trash], now, 5)).toEqual([]);
  });

  it("Q283: skips a group changed during the Undo window, and takes it once the window has passed", () => {
    const p = mk({ doneAt: ago(10), updatedAt: old });
    const s = mk({ parentId: p.id, doneAt: ago(10), leftWithId: p.id, updatedAt: now - UNDO_WINDOW_MS + 1 });
    expect(UNDO_WINDOW_MS).toBe(11_000);
    expect(selectArchiveExpired([p, s], now, 5)).toEqual([]);
    expect(selectArchiveExpired([p, { ...s, updatedAt: now - UNDO_WINDOW_MS }], now, 5).sort()).toEqual([p.id, s.id].sort());
  });
});

describe("selectTrashExpired (FR-017, FR-019)", () => {
  it("uses deletedAt at the same boundaries and takes the rows that went with it", () => {
    const p = mk({ deletedAt: ago(5) });
    const s = mk({ parentId: p.id, deletedAt: ago(5), leftWithId: p.id });
    const young = mk({ deletedAt: ago(5, 1) });
    expect(selectTrashExpired([p, s, young], now, 5).sort()).toEqual([p.id, s.id].sort());
  });

  it("times an item by its deletion date only, never by an old completion date (Q1 clarification)", () => {
    const t = mk({ deletedAt: ago(1), keptDoneAt: ago(1000) });
    expect(selectTrashExpired([t], now, 5)).toEqual([]);
  });

  it("never selects an Archive row", () => {
    expect(selectTrashExpired([mk({ doneAt: ago(99) })], now, 5)).toEqual([]);
  });
});

describe("reminders follow the same rules, with no groups", () => {
  it("Archive by doneAt with the Undo window, Trash by deletedAt", () => {
    const done = mkReminder({ doneAt: ago(6), updatedAt: old });
    const doneNew = mkReminder({ doneAt: ago(4), updatedAt: old });
    const touched = mkReminder({ doneAt: ago(6), updatedAt: now - 1000 });
    const gone = mkReminder({ deletedAt: ago(6), keptDoneAt: ago(1) });
    expect(selectArchiveExpiredReminders([done, doneNew, touched, gone], now, 5)).toEqual([done.id]);
    expect(selectTrashExpiredReminders([done, doneNew, touched, gone], now, 5)).toEqual([gone.id]);
  });
});

describe("the one-hour delay after a change (FR-020b)", () => {
  it("is active when on and no change is pending or the hour has passed", () => {
    expect(cleanupActive({ on: true, hours: 5 }, undefined, now)).toBe(true);
    expect(cleanupActive({ on: true, hours: 5 }, now - HOUR + 1, now)).toBe(false);
    expect(cleanupActive({ on: true, hours: 5 }, now - HOUR, now)).toBe(true);
    expect(cleanupActive({ on: false, hours: 5 }, undefined, now)).toBe(false);
  });
});

describe("the Trash's time left (FR-019)", () => {
  it("is null while the Trash cleanup is off, else the time to the deletion date plus the Trash time", () => {
    expect(timeLeft(now, now, { on: false, hours: 720 })).toBeNull();
    expect(timeLeft(now, now, { on: true, hours: 720 })).toBe(30 * 24 * HOUR);
    expect(timeLeft(ago(718), now, { on: true, hours: 720 })).toBe(2 * HOUR);
    expect(timeLeft(ago(800), now, { on: true, hours: 720 })).toBe(0);
  });
});

describe("the confirmation (FR-020a, FR-020c; Q282, Q287)", () => {
  it("wouldRemove counts what the selector takes, groups and reminders included", () => {
    const p = mk({ doneAt: ago(10), updatedAt: old });
    const s = mk({ parentId: p.id, doneAt: ago(10), leftWithId: p.id, updatedAt: old });
    const r = mkReminder({ doneAt: ago(10), updatedAt: old });
    const g = mk({ deletedAt: ago(10) });
    expect(wouldRemove([p, s, g], [r], now, "archive", 5)).toBe(3);
    expect(wouldRemove([p, s, g], [r], now, "trash", 5)).toBe(1);
    expect(wouldRemove([p, s, g], [r], now, "archive", 50)).toBe(0);
  });

  it("asks for a shorter time or a cleanup turned on only when items would go, and always for the Trash turned off", () => {
    const on = (hours: number) => ({ on: true, hours });
    const off = (hours: number) => ({ on: false, hours });
    expect(needsConfirm("archive", on(100), on(10), 3)).toBe(true);
    expect(needsConfirm("archive", on(100), on(10), 0)).toBe(false);
    expect(needsConfirm("archive", off(10), on(10), 2)).toBe(true);
    expect(needsConfirm("archive", off(10), on(10), 0)).toBe(false);
    expect(needsConfirm("archive", on(10), on(100), 5)).toBe(false);
    expect(needsConfirm("archive", on(10), off(10), 5)).toBe(false);
    expect(needsConfirm("trash", on(10), off(10), 0)).toBe(true);
    expect(needsConfirm("trash", on(10), off(5), 0)).toBe(true);
  });
});

describe("an import only keeps more (FR-016a, Q280)", () => {
  it("takes a switch turned off and a longer time, ignores a switch turned on and a shorter time", () => {
    expect(keepsMore("archiveCleanupOn", true, false)).toBe(true);
    expect(keepsMore("archiveCleanupOn", false, true)).toBe(false);
    expect(keepsMore("trashCleanupHours", 720, 1000)).toBe(true);
    expect(keepsMore("trashCleanupHours", 720, 100)).toBe(false);
    expect(keepsMore("trashCleanupHours", 720, 720)).toBe(false);
  });
});

describe("an Undo import that puts a cleanup back counts as a change (FR-016a, research §7)", () => {
  it("names the cleanups whose switch or time differs", () => {
    const a = { archive: { on: true, hours: 10 }, trash: { on: true, hours: 720 } };
    expect(changedCleanups(a, a)).toEqual([]);
    expect(changedCleanups(a, { ...a, trash: { on: false, hours: 720 } })).toEqual(["trash"]);
    expect(changedCleanups(a, { archive: { on: true, hours: 11 }, trash: { on: true, hours: 1 } })).toEqual(["archive", "trash"]);
  });
});

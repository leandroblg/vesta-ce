// 001 FR-035, 002 FR-019: the Trash rule, from 018 the Trash cleanup's selector at its 30-day default (720 hours); the
// Archive cleanup and the time left are tested in cleanup.test.ts.
import { describe, expect, it } from "vitest";
import { DAY_MS, selectTrashExpired, selectTrashExpiredReminders } from "../../../src/domain/cleanup";
import { mk, mkReminder } from "./fixtures";

const NOW = 100 * DAY_MS;
const H = 720;

describe("selectTrashExpired (FR-035)", () => {
  it("selects rows deleted 30 × 24 h ago or more, with the rows that went with them", () => {
    const old = mk({ deletedAt: NOW - 30 * DAY_MS });
    const along = mk({ parentId: old.id, deletedAt: NOW - 30 * DAY_MS, leftWithId: old.id });
    const recent = mk({ deletedAt: NOW - 30 * DAY_MS + 1 });
    const active = mk();
    const done = mk({ doneAt: 1 });
    expect(selectTrashExpired([old, along, recent, active, done], NOW, H).sort()).toEqual([old.id, along.id].sort());
  });

  it("does not select subtasks restored on their own", () => {
    const old = mk({ deletedAt: 1 });
    const restoredAlone = mk({ parentId: null, deletedAt: null, leftWithId: null });
    expect(selectTrashExpired([old, restoredAlone], NOW, H)).toEqual([old.id]);
  });
});

describe("selectTrashExpiredReminders (002 FR-019)", () => {
  it("selects reminders deleted 30 × 24 h ago or more, never done ones", () => {
    const expired = mkReminder({ deletedAt: NOW - 30 * DAY_MS });
    const justInside = mkReminder({ deletedAt: NOW - 30 * DAY_MS + 1 });
    const done = mkReminder({ doneAt: 1 });
    const active = mkReminder();
    expect(selectTrashExpiredReminders([expired, justInside, done, active], NOW, H)).toEqual([expired.id]);
  });
});

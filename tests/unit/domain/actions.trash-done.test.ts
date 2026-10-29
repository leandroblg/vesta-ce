// 018 US3 (FR-010, data-model.md "Transitions"; PRD Q272, Q281): an Archive entry goes to the Trash with its group,
// keeping each row's completion date in keptDoneAt.
import { describe, expect, it } from "vitest";
import { trashDone } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { trashDoneReminder } from "../../../src/domain/reminder-actions";
import { DomainError, type Task } from "../../../src/domain/task";
import { id, mk, mkReminder } from "./fixtures";

const now = 50_000;
const clock = fixedClock(now);
const get = (cs: { upserts: Task[] }, key: string) => cs.upserts.find((t) => t.id === key);

describe("trashDone (FR-010)", () => {
  it("moves a done parent and the subtasks that went with it, each keeping its own completion date", () => {
    const p = mk({ doneAt: 30 });
    const s1 = mk({ parentId: p.id, position: 1, doneAt: 30, leftWithId: p.id });
    const s2 = mk({ parentId: p.id, position: 2, doneAt: 20, leftWithId: p.id });
    const doneEarlier = mk({ parentId: p.id, position: 3, doneAt: 10 });
    const cs = trashDone(p.id, [p, s1, s2, doneEarlier], clock);
    expect(cs.removals).toEqual([]);
    expect(cs.upserts.map((t) => t.id).sort()).toEqual([p.id, s1.id, s2.id].sort());
    expect(get(cs, p.id)).toEqual({ ...p, doneAt: null, deletedAt: now, keptDoneAt: 30, updatedAt: now });
    expect(get(cs, s1.id)).toEqual({ ...s1, doneAt: null, deletedAt: now, keptDoneAt: 30, updatedAt: now, leftWithId: p.id });
    expect(get(cs, s2.id)).toEqual({ ...s2, doneAt: null, deletedAt: now, keptDoneAt: 20, updatedAt: now, leftWithId: p.id });
  });

  it("moves a done subtask listed on its own alone, its active parent staying", () => {
    const p = mk();
    const s = mk({ parentId: p.id, doneAt: 40 });
    const cs = trashDone(s.id, [p, s], clock);
    expect(cs.upserts).toEqual([{ ...s, doneAt: null, deletedAt: now, keptDoneAt: 40, updatedAt: now }]);
  });

  it("a subtask that went with its parent, deleted alone, is listed on its own in the Trash; the parent stays", () => {
    const p = mk({ doneAt: 30 });
    const s = mk({ parentId: p.id, doneAt: 30, leftWithId: p.id });
    const cs = trashDone(s.id, [p, s], clock);
    expect(cs.upserts).toEqual([{ ...s, doneAt: null, deletedAt: now, keptDoneAt: 30, updatedAt: now, leftWithId: null }]);
  });

  it("T088: a subtask that went with its parent, deleted alone first, is not taken again by the parent's delete", () => {
    const p = mk({ doneAt: 30 });
    const s1 = mk({ parentId: p.id, position: 1, doneAt: 30, leftWithId: p.id });
    const s2 = mk({ parentId: p.id, position: 2, doneAt: 20, leftWithId: p.id });
    const first = trashDone(s1.id, [p, s1, s2], clock);
    const after = [p, s2, ...first.upserts];
    const cs = trashDone(p.id, after, clock);
    expect(cs.upserts.map((t) => t.id).sort()).toEqual([p.id, s2.id].sort());
    expect(get(cs, s2.id)).toMatchObject({ deletedAt: now, keptDoneAt: 20, leftWithId: p.id });
  });

  it("refuses an active or deleted row and a missing one", () => {
    const active = mk();
    const deleted = mk({ deletedAt: 5 });
    for (const t of [active, deleted]) {
      expect(() => trashDone(t.id, [t], clock)).toThrow(DomainError);
      try {
        trashDone(t.id, [t], clock);
      } catch (e) {
        expect((e as DomainError).code).toBe("INVALID");
      }
    }
    try {
      trashDone(id(999), [active], clock);
      expect.unreachable();
    } catch (e) {
      expect((e as DomainError).code).toBe("NOT_FOUND");
    }
  });
});

describe("trashDoneReminder (FR-010)", () => {
  it("moves a done reminder to the Trash, keeping its completion date", () => {
    const r = mkReminder({ doneAt: 70 });
    const cs = trashDoneReminder(r.id, [r], clock);
    expect(cs).toEqual({ upserts: [{ ...r, doneAt: null, deletedAt: now, keptDoneAt: 70, updatedAt: now }], removals: [], sectionCollapsed: null });
  });

  it("refuses an active or deleted reminder", () => {
    for (const r of [mkReminder(), mkReminder({ deletedAt: 5 })]) expect(() => trashDoneReminder(r.id, [r], clock)).toThrow(DomainError);
  });
});

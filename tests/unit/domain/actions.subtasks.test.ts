import { describe, expect, it } from "vitest";
import { create, setCollapsed } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError } from "../../../src/domain/task";
import { hasActiveSubtasks } from "../../../src/domain/tree";
import { id, idGen, mk } from "./fixtures";

const clock = fixedClock(7000);

describe("subtasks (FR-014, FR-015)", () => {
  it("appends a subtask at the end of an active top-level task's subtasks", () => {
    const parent = mk();
    const s1 = mk({ parentId: parent.id, position: 1 });
    const s2 = mk({ parentId: parent.id, position: 2 });
    const cs = create({ title: "Gather numbers", parentId: parent.id }, [parent, s1, s2], clock, idGen());
    expect(cs.upserts).toHaveLength(1);
    expect(cs.upserts[0]).toMatchObject({ id: id(1), parentId: parent.id, position: 3, titleMd: "Gather numbers" });
  });

  it("expands a collapsed parent when a subtask is added, without changing its last-edit time", () => {
    const parent = mk({ collapsed: true, updatedAt: 42 });
    const cs = create({ title: "Step", parentId: parent.id }, [parent], clock, idGen());
    expect(cs.upserts).toContainEqual({ ...parent, collapsed: false, updatedAt: 42 });
  });

  it("rejects a parent that is a subtask, done, deleted or missing", () => {
    const top = mk();
    const sub = mk({ parentId: top.id });
    const done = mk({ doneAt: 1 });
    const deleted = mk({ deletedAt: 1 });
    const rows = [top, sub, done, deleted];
    for (const parentId of [sub.id, done.id, deleted.id, id(999)]) {
      expect(() => create({ title: "x", parentId }, rows, clock, idGen())).toThrow(DomainError);
    }
  });

  it("an empty subtask title creates nothing", () => {
    const parent = mk();
    expect(create({ title: "  ", parentId: parent.id }, [parent], clock, idGen()).upserts).toEqual([]);
  });
});

describe("collapse (FR-016, FR-020)", () => {
  it("changes collapsed and leaves the last-edit time unchanged", () => {
    const parent = mk({ updatedAt: 55 });
    expect(setCollapsed(parent.id, true, [parent])).toEqual({
      upserts: [{ ...parent, collapsed: true, updatedAt: 55 }],
      removals: [],
    });
  });

  it("does nothing when the state is already the requested one", () => {
    const parent = mk({ collapsed: true });
    expect(setCollapsed(parent.id, true, [parent])).toEqual({ upserts: [], removals: [] });
  });

  it("hasActiveSubtasks is true only with a subtask that is neither done nor deleted", () => {
    const p = mk();
    const done = mk({ parentId: p.id, doneAt: 1 });
    const deleted = mk({ parentId: p.id, deletedAt: 1 });
    expect(hasActiveSubtasks(p, [p, done, deleted])).toBe(false);
    const active = mk({ parentId: p.id });
    expect(hasActiveSubtasks(p, [p, done, deleted, active])).toBe(true);
  });
});

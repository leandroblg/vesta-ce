import { describe, expect, it } from "vitest";
import { markDone, remove } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError, type Task } from "../../../src/domain/task";
import { mk } from "./fixtures";

const clock = fixedClock(8000);
const byId = (cs: { upserts: Task[] }, id: string) => cs.upserts.find((t) => t.id === id);

describe.each([
  ["markDone", markDone, "doneAt"],
  ["delete", remove, "deletedAt"],
] as const)("%s (FR-021 to FR-024)", (_name, action, field) => {
  it("sets the time and records the neighbours in its list", () => {
    const a = mk({ position: 1 });
    const b = mk({ position: 2 });
    const c = mk({ position: 3 });
    const cs = action(b.id, [a, b, c], clock);
    expect(cs.removals).toEqual([]);
    expect(cs.upserts).toEqual([{ ...b, [field]: 8000, updatedAt: 8000, prevSiblingId: a.id, nextSiblingId: c.id, leftWithId: null }]);
  });

  it("a parent takes its active subtasks along, keeping their positions", () => {
    const p = mk();
    const s1 = mk({ parentId: p.id, position: 1 });
    const s2 = mk({ parentId: p.id, position: 2 });
    const cs = action(p.id, [p, s1, s2], clock);
    expect(byId(cs, s1.id)).toEqual({ ...s1, [field]: 8000, updatedAt: 8000, leftWithId: p.id });
    expect(byId(cs, s2.id)).toEqual({ ...s2, [field]: 8000, updatedAt: 8000, leftWithId: p.id });
    expect(cs.upserts[0]?.id).toBe(p.id);
  });

  it("does not take subtasks that already left", () => {
    const p = mk();
    const gone = mk({ parentId: p.id, doneAt: 1 });
    const trashed = mk({ parentId: p.id, deletedAt: 1 });
    const cs = action(p.id, [p, gone, trashed], clock);
    expect(cs.upserts.map((t) => t.id)).toEqual([p.id]);
  });

  it("a subtask alone leaves its parent and records its sibling neighbours", () => {
    const p = mk();
    const s1 = mk({ parentId: p.id, position: 1 });
    const s2 = mk({ parentId: p.id, position: 2 });
    const cs = action(s2.id, [p, s1, s2], clock);
    expect(cs.upserts).toEqual([{ ...s2, [field]: 8000, updatedAt: 8000, prevSiblingId: s1.id, nextSiblingId: null, leftWithId: null }]);
  });

  it("rejects items that are not active", () => {
    const done = mk({ doneAt: 1 });
    const deleted = mk({ deletedAt: 1 });
    expect(() => action(done.id, [done], clock)).toThrow(DomainError);
    expect(() => action(deleted.id, [deleted], clock)).toThrow(DomainError);
  });
});

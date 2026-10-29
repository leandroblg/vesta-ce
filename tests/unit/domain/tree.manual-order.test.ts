import { describe, expect, it } from "vitest";
import { manualOrder } from "../../../src/domain/tree";
import { mk } from "./fixtures";

describe("manualOrder (004 data-model: the non-pinned top-level tasks by position)", () => {
  it("lists active top-level tasks that are not pinned, by position then creation time", () => {
    const a = mk({ position: 3 });
    const b = mk({ position: 1, createdAt: 200 });
    const c = mk({ position: 1, createdAt: 150 });
    expect(manualOrder([a, b, c]).map((t) => t.id)).toEqual([c.id, b.id, a.id]);
  });

  it("includes a positioned-by-hand stale task and excludes pinned tasks, subtasks and inactive rows", () => {
    const manual = mk({ position: 2, staleSince: 500, manuallyPositioned: true });
    const pinned = mk({ position: 1, staleSince: 500 });
    const plain = mk({ position: 3 });
    const sub = mk({ parentId: plain.id, position: 1 });
    const done = mk({ position: 4, doneAt: 600 });
    const deleted = mk({ position: 5, deletedAt: 600 });
    expect(manualOrder([manual, pinned, plain, sub, done, deleted]).map((t) => t.id)).toEqual([manual.id, plain.id]);
  });
});

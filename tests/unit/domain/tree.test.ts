import { describe, expect, it } from "vitest";
import { activeTree } from "../../../src/domain/tree";
import { mk } from "./fixtures";

describe("activeTree (FR-005)", () => {
  it("lists active top-level tasks by position, each with its active subtasks by position", () => {
    const b = mk({ titleMd: "B", position: 2 });
    const a = mk({ titleMd: "A", position: 1 });
    const a2 = mk({ titleMd: "a2", parentId: a.id, position: 2 });
    const a1 = mk({ titleMd: "a1", parentId: a.id, position: 1 });
    const aDone = mk({ titleMd: "aDone", parentId: a.id, position: 3, doneAt: 9 });
    const c = mk({ titleMd: "C", position: 3, deletedAt: 9 });
    const tree = activeTree([b, a2, c, a, aDone, a1]);
    expect(tree.map((n) => [n.task.titleMd, n.subtasks.map((s) => s.titleMd)])).toEqual([
      ["A", ["a1", "a2"]],
      ["B", []],
    ]);
  });

  it("is empty when nothing is active", () => {
    expect(activeTree([mk({ doneAt: 1 }), mk({ deletedAt: 1 })])).toEqual([]);
  });
});

describe("equal positions (008 FR-036)", () => {
  it("orders siblings with equal position and creation time by id", () => {
    const b = mk({ id: "00000000-0000-4000-8000-00000000000b", position: 1, createdAt: 100 });
    const a = mk({ id: "00000000-0000-4000-8000-00000000000a", position: 1, createdAt: 100 });
    expect(activeTree([b, a]).map((n) => n.task.id)).toEqual([a.id, b.id]);
    expect(activeTree([a, b]).map((n) => n.task.id)).toEqual([a.id, b.id]);
  });
});

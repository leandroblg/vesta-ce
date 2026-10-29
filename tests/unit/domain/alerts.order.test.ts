/** Stale group ordering (003 FR-024 to FR-027, T039). */
import { describe, expect, it } from "vitest";
import { activeTree } from "../../../src/domain/tree";
import { mk } from "./fixtures";

const order = (tree: { task: { titleMd: string } }[]) => tree.map((n) => n.task.titleMd);

describe("activeTree with the stale group", () => {
  it("puts auto-sorted stale tasks first, oldest first, then the others by position", () => {
    const a = mk({ titleMd: "A", position: 1, createdAt: 300 });
    const b = mk({ titleMd: "B", position: 2, createdAt: 200, staleSince: 900 });
    const c = mk({ titleMd: "C", position: 3, createdAt: 100, staleSince: 950 });
    const d = mk({ titleMd: "D", position: 4, createdAt: 400 });
    expect(order(activeTree([a, b, c, d]))).toEqual(["C", "B", "A", "D"]);
  });

  it("breaks creation-time ties by position, then id (CHK031)", () => {
    const x = mk({ titleMd: "X", position: 5, createdAt: 100, staleSince: 900 });
    const y = mk({ titleMd: "Y", position: 2, createdAt: 100, staleSince: 900 });
    const z = mk({ titleMd: "Z", position: 2, createdAt: 100, staleSince: 900, id: "00000000-0000-4000-8000-000000000001" });
    expect(order(activeTree([x, y, z]))).toEqual(["Z", "Y", "X"]);
  });

  it("carries subtasks with their parent, in position order, never sorted by age (FR-027)", () => {
    const p = mk({ titleMd: "P", position: 2, createdAt: 100, staleSince: 900 });
    const s1 = mk({ titleMd: "S1", parentId: p.id, position: 1, createdAt: 500 });
    const s2 = mk({ titleMd: "S2", parentId: p.id, position: 2, createdAt: 10, staleSince: 800 });
    const q = mk({ titleMd: "Q", position: 1, createdAt: 50 });
    const tree = activeTree([q, s2, p, s1]);
    expect(order(tree)).toEqual(["P", "Q"]);
    expect(tree[0]?.subtasks.map((s) => s.titleMd)).toEqual(["S1", "S2"]);
  });

  it("a stale subtask never moves its parent", () => {
    const p = mk({ titleMd: "P", position: 2 });
    const s = mk({ titleMd: "S", parentId: p.id, position: 1, staleSince: 900 });
    const q = mk({ titleMd: "Q", position: 1 });
    expect(order(activeTree([p, s, q]))).toEqual(["Q", "P"]);
  });

  it("keeps a manually positioned stale task at its saved position (FR-026)", () => {
    const a = mk({ titleMd: "A", position: 1 });
    const m = mk({ titleMd: "M", position: 2, createdAt: 1, staleSince: 900, manuallyPositioned: true });
    const s = mk({ titleMd: "S", position: 3, createdAt: 50, staleSince: 900 });
    expect(order(activeTree([a, m, s]))).toEqual(["S", "A", "M"]);
  });

  it("keeps an exempt stale task at its saved position until it is no longer exempt (FR-025)", () => {
    const a = mk({ titleMd: "A", position: 1 });
    const e = mk({ titleMd: "E", position: 2, createdAt: 1, staleSince: 900 });
    expect(order(activeTree([a, e], { exempt: new Set([e.id]) }))).toEqual(["A", "E"]);
    expect(order(activeTree([a, e]))).toEqual(["E", "A"]);
  });

  it("ignores done and deleted rows", () => {
    const a = mk({ titleMd: "A", position: 1 });
    const gone = mk({ titleMd: "G", position: 2, staleSince: 900, doneAt: 950 });
    expect(order(activeTree([a, gone]))).toEqual(["A"]);
  });
});

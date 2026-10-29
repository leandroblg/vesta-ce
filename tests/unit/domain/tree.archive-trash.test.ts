import { describe, expect, it } from "vitest";
import { archiveView, counts, trashView } from "../../../src/domain/tree";
import { mk } from "./fixtures";

describe("archiveView (FR-031)", () => {
  it("lists done entries newest first, with taken-along subtasks under them and parent context for lone subtasks", () => {
    const active = mk({ titleMd: "Active parent" });
    const loneSub = mk({ titleMd: "Lone", parentId: active.id, doneAt: 30 });
    const p = mk({ titleMd: "Done parent", doneAt: 20 });
    const s2 = mk({ titleMd: "s2", parentId: p.id, position: 2, doneAt: 20, leftWithId: p.id });
    const s1 = mk({ titleMd: "s1", parentId: p.id, position: 1, doneAt: 20, leftWithId: p.id });
    const old = mk({ titleMd: "Old", doneAt: 10 });
    const trashed = mk({ deletedAt: 40 });
    const view = archiveView([active, loneSub, p, s2, s1, old, trashed]);
    expect(view.map((e) => [e.task.titleMd, e.parentTitle, e.subtasks.map((s) => s.titleMd)])).toEqual([
      ["Lone", "Active parent", []],
      ["Done parent", null, ["s1", "s2"]],
      ["Old", null, []],
    ]);
  });

  it("keeps the parent context while the parent row exists, active, done or deleted", () => {
    const deletedParent = mk({ titleMd: "Gone parent", deletedAt: 50 });
    const sub = mk({ parentId: deletedParent.id, doneAt: 30 });
    expect(archiveView([deletedParent, sub])[0]?.parentTitle).toBe("Gone parent");
    expect(archiveView([sub])[0]?.parentTitle).toBeNull();
  });
});

describe("trashView (FR-033)", () => {
  it("lists deleted entries newest first, with their kind and taken-along subtasks", () => {
    const parent = mk({ titleMd: "P" });
    const sub = mk({ titleMd: "Sub alone", parentId: parent.id, deletedAt: 9 });
    const t = mk({ titleMd: "Task", deletedAt: 5 });
    const along = mk({ titleMd: "along", parentId: t.id, deletedAt: 5, leftWithId: t.id });
    const view = trashView([parent, sub, t, along]);
    expect(view.map((e) => [e.task.titleMd, e.parentTitle, e.subtasks.map((s) => s.titleMd)])).toEqual([
      ["Sub alone", "P", []],
      ["Task", null, ["along"]],
    ]);
  });
});

describe("counts (FR-002)", () => {
  it("counts every task and subtask in the Archive and in the Trash", () => {
    const p = mk({ doneAt: 1 });
    const s = mk({ parentId: p.id, doneAt: 1, leftWithId: p.id });
    const d = mk({ deletedAt: 1 });
    expect(counts([p, s, d, mk()])).toEqual({ archive: 2, trash: 1 });
  });
});

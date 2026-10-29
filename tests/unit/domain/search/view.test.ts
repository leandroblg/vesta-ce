// T011: the filtered view and the Archive and Trash order (006 FR-005 to FR-010, FR-017, FR-018; research §6).
import { describe, expect, it } from "vitest";
import { activeTree } from "../../../../src/domain/tree";
import { activeReminders } from "../../../../src/domain/reminder-views";
import { elsewhereOrder, searchView, type MatchInfo } from "../../../../src/domain/search/view";
import type { Task } from "../../../../src/domain/task";
import { mk, mkReminder } from "../fixtures";

const hit = (inTitle = true, excerpt: string | null = null): MatchInfo => ({ inTitle, excerpt });

function view(
  tasks: Task[],
  matches: Record<string, MatchInfo>,
  opts: { pinned?: string[]; active?: boolean; include?: boolean; reminders?: ReturnType<typeof mkReminder>[] } = {},
) {
  const reminders = opts.reminders ?? [];
  return searchView({
    active: opts.active ?? true,
    tree: activeTree(tasks),
    reminders: activeReminders(reminders),
    allTasks: tasks,
    allReminders: reminders,
    matches: new Map(Object.entries(matches)),
    pinned: new Set(opts.pinned ?? []),
    includeArchiveTrash: opts.include ?? false,
  });
}

const ids = (tree: { task: Task; subtasks: Task[] }[]) => tree.map((n) => [n.task.titleMd, n.subtasks.map((s) => s.titleMd)]);

describe("searchView: main view", () => {
  it("returns the unfiltered lists while no search is active", () => {
    const a = mk({ titleMd: "A" });
    const r = mkReminder({ textMd: "R" });
    const v = view([a], {}, { active: false, reminders: [r] });
    expect(ids(v.tree)).toEqual([["A", []]]);
    expect(v.reminders.map((x) => x.textMd)).toEqual(["R"]);
    expect(v.elsewhere).toEqual([]);
  });

  it("shows only active matches, in the existing order (stale group first)", () => {
    const old = mk({ titleMd: "Old stale", createdAt: 10, staleSince: 50 });
    const a = mk({ titleMd: "A" });
    const b = mk({ titleMd: "B" });
    const done = mk({ titleMd: "Done", doneAt: 500 });
    const v = view([a, b, old, done], { [a.id]: hit(), [old.id]: hit(), [done.id]: hit() });
    expect(ids(v.tree)).toEqual([
      ["Old stale", []],
      ["A", []],
    ]);
  });

  it("shows a parent for a matching subtask, with only its matching subtasks, collapsed or not", () => {
    const p = mk({ titleMd: "Parent", collapsed: true });
    const s1 = mk({ titleMd: "S1", parentId: p.id });
    const s2 = mk({ titleMd: "S2", parentId: p.id });
    expect(ids(view([p, s1, s2], { [s2.id]: hit() }).tree)).toEqual([["Parent", ["S2"]]]);
    // Matching itself changes nothing: still only the matching subtasks.
    expect(ids(view([p, s1, s2], { [p.id]: hit(), [s1.id]: hit() }).tree)).toEqual([["Parent", ["S1"]]]);
  });

  it("shows a matching parent with no matching subtask alone", () => {
    const p = mk({ titleMd: "Parent" });
    const s = mk({ titleMd: "S", parentId: p.id });
    expect(ids(view([p, s], { [p.id]: hit() }).tree)).toEqual([["Parent", []]]);
  });

  it("shows pinned ids even when they do not match, with their parent", () => {
    const p = mk({ titleMd: "Parent" });
    const s = mk({ titleMd: "New sub", parentId: p.id });
    const lone = mk({ titleMd: "Edited" });
    expect(ids(view([p, s, lone], {}, { pinned: [s.id, lone.id] }).tree)).toEqual([
      ["Parent", ["New sub"]],
      ["Edited", []],
    ]);
  });

  it("filters reminders and ignores a collapsed Reminders section (the caller passes them all)", () => {
    const r1 = mkReminder({ textMd: "Call bank" });
    const r2 = mkReminder({ textMd: "Dry cleaning" });
    const r3 = mkReminder({ textMd: "Pinned" });
    const v = view([], { [r1.id]: hit() }, { reminders: [r1, r2, r3], pinned: [r3.id] });
    expect(v.reminders.map((r) => r.textMd)).toEqual(["Call bank", "Pinned"]);
  });

  it("flags 'no matches' per section only when it has active items but none shown (FR-010)", () => {
    const a = mk({ titleMd: "A" });
    const r = mkReminder({ textMd: "R" });
    const none = view([a], {}, { reminders: [r] });
    expect(none.tasksNoMatches).toBe(true);
    expect(none.remindersNoMatches).toBe(true);
    const empty = view([], {});
    expect(empty.tasksNoMatches).toBe(false);
    expect(empty.remindersNoMatches).toBe(false);
  });

  it("exposes each shown card's match info", () => {
    const a = mk({ titleMd: "A" });
    const v = view([a], { [a.id]: hit(false, "…invoice 2291…") });
    expect(v.match(a.id)).toEqual({ inTitle: false, excerpt: "…invoice 2291…" });
    expect(v.match("nope")).toBeNull();
  });
});

describe("searchView: Archive and Trash rows (FR-017, FR-018)", () => {
  it("lists nothing unless includeArchiveTrash", () => {
    const d = mk({ titleMd: "Done", doneAt: 500 });
    expect(view([d], { [d.id]: hit() }).elsewhere).toEqual([]);
    expect(view([d], { [d.id]: hit() }, { include: true }).elsewhere.map((e) => e.id)).toEqual([d.id]);
  });

  it("lists each matching done or deleted item on its own; FR-006 does not apply there", () => {
    const p = mk({ titleMd: "Parent", doneAt: 500 });
    const s = mk({ titleMd: "Sub", parentId: p.id, doneAt: 500, leftWithId: p.id });
    const v = view([p, s], { [s.id]: hit() }, { include: true });
    expect(v.elsewhere.map((e) => e.id)).toEqual([s.id]);
    expect(v.elsewhere[0]?.parentTitle).toBe("Parent");
  });

  it("gives parent context only while the parent row exists", () => {
    const orphan = mk({ titleMd: "Orphan", parentId: "gone", deletedAt: 400 });
    const r = mkReminder({ textMd: "Rem", doneAt: 300 });
    const v = view([orphan], { [orphan.id]: hit(), [r.id]: hit() }, { include: true, reminders: [r] });
    expect(v.elsewhere.map((e) => [e.kind, e.parentTitle])).toEqual([
      ["task", null],
      ["reminder", null],
    ]);
  });

  it("never lists active items there", () => {
    const a = mk({ titleMd: "A" });
    expect(view([a], { [a.id]: hit() }, { include: true }).elsewhere).toEqual([]);
  });
});

describe("elsewhereOrder", () => {
  it("orders newest first by completion or deletion date", () => {
    const a = mk({ titleMd: "A", doneAt: 100 });
    const b = mk({ titleMd: "B", deletedAt: 300 });
    const r = mkReminder({ textMd: "R", doneAt: 200 });
    const out = elsewhereOrder([
      { kind: "task", row: a },
      { kind: "task", row: b },
      { kind: "reminder", row: r },
    ]);
    expect(out.map((e) => e.row.id)).toEqual([b.id, r.id, a.id]);
  });

  it("on equal dates puts a parent before the subtasks that left with it, in position order", () => {
    const p = mk({ titleMd: "P", doneAt: 500, createdAt: 1 });
    const s2 = mk({ titleMd: "S2", parentId: p.id, doneAt: 500, leftWithId: p.id, position: 2, createdAt: 9 });
    const s1 = mk({ titleMd: "S1", parentId: p.id, doneAt: 500, leftWithId: p.id, position: 1, createdAt: 8 });
    const out = elsewhereOrder([s2, s1, p].map((row) => ({ kind: "task" as const, row })));
    expect(out.map((e) => (e.row).titleMd)).toEqual(["P", "S1", "S2"]);
  });

  it("breaks other ties by newest creation time", () => {
    const older = mk({ titleMd: "Older", doneAt: 500, createdAt: 10 });
    const newer = mk({ titleMd: "Newer", doneAt: 500, createdAt: 20 });
    const out = elsewhereOrder([older, newer].map((row) => ({ kind: "task" as const, row })));
    expect(out.map((e) => (e.row).titleMd)).toEqual(["Newer", "Older"]);
  });
});

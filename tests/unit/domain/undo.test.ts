import { describe, expect, it } from "vitest";
import { markDone, remove, reschedule, restore, trashDone } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import type { Reminder } from "../../../src/domain/reminder";
import type { ChangeSet, Task } from "../../../src/domain/task";
import { markReminderDone, removeReminder, restoreReminder, trashDoneReminder } from "../../../src/domain/reminder-actions";
import { applyReminderUndo, applyUndo, beforeOf } from "../../../src/domain/undo";
import { mk, mkReminder } from "./fixtures";

function apply(rows: Task[], cs: ChangeSet): Task[] {
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const u of cs.upserts) map.set(u.id, u);
  for (const id of cs.removals) map.delete(id);
  return [...map.values()];
}

describe("undo (FR-026)", () => {
  it.each([["done", markDone] as const, ["delete", remove] as const])("undoing %s puts a parent and its subtasks back in place", (kind, action) => {
    const a = mk({ position: 1 });
    const p = mk({ position: 2 });
    const s1 = mk({ parentId: p.id, position: 1 });
    const c = mk({ position: 3 });
    const rows = [a, p, s1, c];
    const cs = action(p.id, rows, fixedClock(100));
    const after = apply(rows, cs);
    const undo = applyUndo({ kind, before: beforeOf(rows, cs) }, after, fixedClock(200));
    const back = apply(after, undo);
    const get = (id: string) => back.find((t) => t.id === id);
    expect(get(p.id)).toMatchObject({ doneAt: null, deletedAt: null, prevSiblingId: null, nextSiblingId: null, updatedAt: 200 });
    expect(get(s1.id)).toMatchObject({ doneAt: null, deletedAt: null, leftWithId: null, parentId: p.id, updatedAt: 200 });
    const order = back.filter((t) => t.parentId === null).sort((x, y) => x.position - y.position).map((t) => t.id);
    expect(order).toEqual([a.id, p.id, c.id]);
  });

  it("undoing a restore writes back the completion or deletion fields, keeping later edits", () => {
    const before = mk({ titleMd: "Old", doneAt: 50, prevSiblingId: "x", position: 7, parentId: null });
    const restored: Task = { ...before, titleMd: "Edited after restore", doneAt: null, prevSiblingId: null, position: 1, updatedAt: 60 };
    const parentExpanded = mk({ collapsed: false });
    const undo = applyUndo({ kind: "restore", before: [before, { ...parentExpanded, collapsed: true }] }, [restored, parentExpanded], fixedClock(300));
    // 003 FR-028a (Q103): the parent the restore expanded collapses again; collapse is not an edit.
    expect(undo.upserts).toEqual([
      { ...restored, doneAt: 50, prevSiblingId: "x", position: 7, updatedAt: 300 },
      { ...parentExpanded, collapsed: true },
    ]);
  });

  it("undoing a restore re-collapses the parent it expanded, in both restore cases (003 FR-028a)", () => {
    // A subtask restored alone into a collapsed parent.
    const p = mk({ collapsed: true });
    const s = mk({ parentId: p.id, doneAt: 50 });
    const restoredS: Task = { ...s, doneAt: null, updatedAt: 60 };
    const expandedP: Task = { ...p, collapsed: false };
    const one = applyUndo({ kind: "restore", before: [s, p] }, [restoredS, expandedP], fixedClock(300));
    expect(one.upserts.find((t) => t.id === p.id)).toEqual({ ...p, collapsed: true });

    // A collapsed parent restored with its subtasks.
    const q = mk({ collapsed: true, doneAt: 50 });
    const qs = mk({ parentId: q.id, doneAt: 50, leftWithId: q.id });
    const backQ: Task = { ...q, collapsed: false, doneAt: null, updatedAt: 60 };
    const backQs: Task = { ...qs, doneAt: null, leftWithId: null, updatedAt: 60 };
    const two = applyUndo({ kind: "restore", before: [q, qs] }, [backQ, backQs], fixedClock(300));
    expect(two.upserts.find((t) => t.id === q.id)).toMatchObject({ doneAt: 50, collapsed: true, updatedAt: 300 });
  });

  it("undoing a restore leaves a parent the user collapsed again as it is, with no extra row", () => {
    const p = mk({ collapsed: true });
    const s = mk({ parentId: p.id, doneAt: 50 });
    const restoredS: Task = { ...s, doneAt: null, updatedAt: 60 };
    const undo = applyUndo({ kind: "restore", before: [s, p] }, [restoredS, p], fixedClock(300));
    expect(undo.upserts.map((t) => t.id)).toEqual([s.id]);
  });

  it("undo of a stale task's done keeps every alert field, the manual mark included (003 FR-007, FR-028)", () => {
    const alert = { staleSince: 900, wasStale: true, firstBlinkCount: 3 as const, lastBlinkAt: 950, manuallyPositioned: true, alertOverrideMin: 600 };
    const before = mk({ ...alert });
    const done: Task = { ...before, doneAt: 1000 };
    const back = applyUndo({ kind: "done", before: [before] }, [done], fixedClock(1100)).upserts.find((t) => t.id === before.id);
    expect(back).toMatchObject({ ...alert, doneAt: null });
  });

  it("beforeOf returns the rows a ChangeSet touches, as they were", () => {
    const a = mk();
    const b = mk();
    expect(beforeOf([a, b], { upserts: [{ ...b, titleMd: "z" }], removals: [] })).toEqual([b]);
  });
});

describe("reminder undo of done and delete (002 FR-015, FR-018)", () => {
  const apply = (kind: "done" | "delete", rows: Reminder[], id: string) => {
    const cs = (kind === "done" ? markReminderDone : removeReminder)(id, rows, fixedClock(100));
    const before = rows.filter((r) => r.id === id);
    const after = rows.map((r) => cs.upserts.find((u) => u.id === r.id) ?? r);
    return { before, after };
  };

  for (const kind of ["done", "delete"] as const) {
    it(`undo of ${kind} puts it back between its neighbours with a new last-edit time`, () => {
      const a = mkReminder({ position: 1 });
      const b = mkReminder({ position: 2 });
      const c = mkReminder({ position: 3 });
      const { before, after } = apply(kind, [a, b, c], b.id);
      const cs = applyReminderUndo({ subject: "reminder", kind, before }, after, fixedClock(200));
      expect(cs.upserts).toEqual([{ ...b, position: 2, updatedAt: 200, doneAt: null, deletedAt: null, prevSiblingId: null, nextSiblingId: null }]);
      expect(cs.sectionCollapsed).toBeNull();
    });
  }

  it("reminders added during the window do not move it: it goes right after its former previous neighbour", () => {
    const a = mkReminder({ position: 1 });
    const b = mkReminder({ position: 2 });
    const c = mkReminder({ position: 3 });
    const { before, after } = apply("done", [a, b, c], b.id);
    const added = mkReminder({ position: 1.5 }); // landed between a and c meanwhile
    const cs = applyReminderUndo({ subject: "reminder", kind: "done", before }, [...after, added], fixedClock(200));
    const back = cs.upserts.find((r) => r.id === b.id);
    expect(back?.position).toBeGreaterThan(a.position);
    expect(back?.position).toBeLessThan(added.position);
  });

  it("falls back to before the former next neighbour, then to the end", () => {
    const a = mkReminder({ position: 1 });
    const b = mkReminder({ position: 2 });
    const c = mkReminder({ position: 3 });
    const { before, after } = apply("delete", [a, b, c], b.id);
    const withoutA = after.map((r) => (r.id === a.id ? { ...r, doneAt: 150 } : r));
    expect(applyReminderUndo({ subject: "reminder", kind: "delete", before }, withoutA, fixedClock(200)).upserts[0]?.position).toBe(2);
    const neither = withoutA.map((r) => (r.id === c.id ? { ...r, deletedAt: 150 } : r));
    const d = mkReminder({ position: 7 });
    expect(applyReminderUndo({ subject: "reminder", kind: "delete", before }, [...neither, d], fixedClock(200)).upserts[0]?.position).toBe(8);
  });

  it("does nothing when the reminder is already active again", () => {
    const a = mkReminder();
    expect(applyReminderUndo({ subject: "reminder", kind: "done", before: [a] }, [a], fixedClock(200))).toEqual({
      upserts: [],
      removals: [],
      sectionCollapsed: null,
    });
  });
});

describe("reminder undo of restore (002 FR-015, FR-018)", () => {
  it("puts it back in the Archive or Trash with its original date, neighbours and position; the section is untouched", () => {
    const a = mkReminder({ position: 1 });
    const b = mkReminder({ position: 7, deletedAt: 50, prevSiblingId: a.id, nextSiblingId: null });
    const cs = restoreReminder(b.id, [a, b], true, fixedClock(100));
    expect(cs.sectionCollapsed).toBe(false);
    const after = [a, ...cs.upserts.filter((u) => u.id === b.id)];
    const undo = applyReminderUndo({ subject: "reminder", kind: "restore", before: [b] }, after, fixedClock(200));
    expect(undo).toEqual({ upserts: [{ ...b, updatedAt: 200 }], removals: [], sectionCollapsed: null });
  });
});


describe("016 undo of a reschedule (FR-002, research §1)", () => {
  const DAY = 86_400_000;
  it("puts back the reschedule's fields as they were and keeps every other field current", () => {
    const stale = mk({ position: 5, manuallyPositioned: true, staleSince: 3 * DAY, wasStale: false, firstBlinkCount: 3, rescheduleForMin: 120, staleBaseAt: 1000 });
    const other = mk({ position: 1 });
    const rows = [other, stale];
    const cs = reschedule(stale.id, rows, fixedClock(4 * DAY), undefined, 240);
    const after = apply(rows, cs);
    // An override changed between the reschedule and its undo stays as it is.
    const edited = after.map((t) => (t.id === stale.id ? { ...t, alertOverrideMin: 600, titleMd: "Edited" } : t));
    const undo = applyUndo({ kind: "reschedule", before: beforeOf(rows, cs) }, edited, fixedClock(5 * DAY));
    const back = apply(edited, undo).find((t) => t.id === stale.id);
    expect(back).toMatchObject({
      staleSince: 3 * DAY,
      firstBlinkCount: 3,
      staleBaseAt: 1000,
      rescheduleForMin: 120,
      wasStale: false,
      position: 5,
      manuallyPositioned: true,
      alertOverrideMin: 600,
      titleMd: "Edited",
      updatedAt: 5 * DAY,
    });
  });

  it("puts a pinned stale task back at its pinned place", () => {
    const DAYS = 3 * DAY;
    const pinned = mk({ position: 1, staleSince: DAYS });
    const b = mk({ position: 2 });
    const rows = [pinned, b];
    const cs = reschedule(pinned.id, rows, fixedClock(DAYS + 1), undefined, null);
    const after = apply(rows, cs);
    const back = apply(after, applyUndo({ kind: "reschedule", before: beforeOf(rows, cs) }, after, fixedClock(DAYS + 2)));
    expect(back.find((t) => t.id === pinned.id)).toMatchObject({ position: 1, staleSince: DAYS });
  });

  it("does nothing for a task that is gone", () => {
    const t = mk({ staleSince: 10 });
    expect(applyUndo({ kind: "reschedule", before: [t] }, [], fixedClock(20))).toEqual({ upserts: [], removals: [] });
  });
});

describe("018 undo of an Archive delete and of a restore back to the Archive (FR-011, FR-012)", () => {
  it("trashDone: the group returns to the Archive with its dates, links and positions", () => {
    const p = mk({ doneAt: 30, position: 4, prevSiblingId: "x", nextSiblingId: "y" });
    const s1 = mk({ parentId: p.id, position: 1, doneAt: 30, leftWithId: p.id });
    const s2 = mk({ parentId: p.id, position: 2, doneAt: 20, leftWithId: p.id });
    const rows = [p, s1, s2];
    const cs = trashDone(p.id, rows, fixedClock(100));
    const after = apply(rows, cs);
    const undo = applyUndo({ kind: "trashDone", before: beforeOf(rows, cs) }, after, fixedClock(200));
    const back = apply(after, undo);
    for (const b of rows) {
      const r = back.find((t) => t.id === b.id);
      expect(r).toMatchObject({
        doneAt: b.doneAt,
        deletedAt: null,
        keptDoneAt: null,
        leftWithId: b.leftWithId,
        parentId: b.parentId,
        position: b.position,
        prevSiblingId: b.prevSiblingId,
        nextSiblingId: b.nextSiblingId,
      });
    }
  });

  it("delete still brings an active item back through bringBack", () => {
    const a = mk({ position: 1 });
    const rows = [a];
    const cs = remove(a.id, rows, fixedClock(100));
    const back = apply(apply(rows, cs), applyUndo({ kind: "delete", before: beforeOf(rows, cs) }, apply(rows, cs), fixedClock(200)));
    expect(back[0]).toMatchObject({ deletedAt: null, doneAt: null });
  });

  it("undoing a restore back to the Archive returns the group to the Trash with its deletion and kept dates", () => {
    const p = mk({ deletedAt: 900, keptDoneAt: 30 });
    const s = mk({ parentId: p.id, deletedAt: 900, keptDoneAt: 20, leftWithId: p.id });
    const rows = [p, s];
    const cs = restore(p.id, rows, fixedClock(1_000));
    const after = apply(rows, cs);
    const back = apply(after, applyUndo({ kind: "restore", before: beforeOf(rows, cs) }, after, fixedClock(1_100)));
    expect(back.find((t) => t.id === p.id)).toMatchObject({ deletedAt: 900, keptDoneAt: 30, doneAt: null });
    expect(back.find((t) => t.id === s.id)).toMatchObject({ deletedAt: 900, keptDoneAt: 20, doneAt: null, leftWithId: p.id });
  });

  it("reminders: trashDone and a restore back to the Archive are undone the same way", () => {
    const r: Reminder = mkReminder({ doneAt: 30 });
    const cs = trashDoneReminder(r.id, [r], fixedClock(100));
    const trashed = cs.upserts[0] as Reminder;
    const undo = applyReminderUndo({ subject: "reminder", kind: "trashDone", before: [r] }, [trashed], fixedClock(200));
    expect(undo.upserts[0]).toMatchObject({ doneAt: 30, deletedAt: null, keptDoneAt: null });
    const restored = restoreReminder(trashed.id, [trashed], false, fixedClock(300)).upserts[0] as Reminder;
    const undoRestore = applyReminderUndo({ subject: "reminder", kind: "restore", before: [trashed] }, [restored], fixedClock(400));
    expect(undoRestore.upserts[0]).toMatchObject({ doneAt: null, deletedAt: 100, keptDoneAt: 30 });
  });
});

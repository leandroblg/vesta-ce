/**
 * SC-002: the rules reminders share with tasks give the same outcome for a reminder as for a top-level
 * task without subtasks. Each scenario runs once per kind through the same adapter-shaped steps; the
 * differences listed in FR-025 are not part of this table.
 */
import { describe, expect, it } from "vitest";
import { create, editTitle, markDone, remove, restore } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import { DAY_MS, selectTrashExpired, selectTrashExpiredReminders, timeLeft } from "../../../src/domain/cleanup";
import type { Reminder } from "../../../src/domain/reminder";
import { createReminder, editReminderText, markReminderDone, removeReminder, restoreReminder } from "../../../src/domain/reminder-actions";
import type { Task } from "../../../src/domain/task";
import { applyReminderUndo, applyUndo } from "../../../src/domain/undo";
import { idGen, mk, mkReminder } from "./fixtures";

/** What a scenario sees of an item, whatever its kind. */
interface Item {
  id: string;
  text: string;
  position: number;
  doneAt: number | null;
  deletedAt: number | null;
  prevSiblingId: string | null;
  nextSiblingId: string | null;
  updatedAt: number;
}

interface Kind {
  name: string;
  make: (o: Partial<Item>) => unknown;
  view: (row: unknown) => Item;
  create: (text: string, rows: unknown[]) => Item[];
  edit: (id: string, text: string, rows: unknown[]) => Item[];
  leave: (how: "done" | "delete", id: string, rows: unknown[]) => Item[];
  undoLeave: (how: "done" | "delete", before: unknown, rows: unknown[]) => Item[];
  restore: (id: string, rows: unknown[]) => Item[];
  expired: (rows: unknown[], now: number) => string[];
}

const clock = fixedClock(1_000);

const taskView = (t: unknown): Item => {
  const x = t as Task;
  return { id: x.id, text: x.titleMd, position: x.position, doneAt: x.doneAt, deletedAt: x.deletedAt, prevSiblingId: x.prevSiblingId, nextSiblingId: x.nextSiblingId, updatedAt: x.updatedAt };
};
const reminderView = (r: unknown): Item => {
  const x = r as Reminder;
  return { id: x.id, text: x.textMd, position: x.position, doneAt: x.doneAt, deletedAt: x.deletedAt, prevSiblingId: x.prevSiblingId, nextSiblingId: x.nextSiblingId, updatedAt: x.updatedAt };
};

const TASK: Kind = {
  name: "top-level task",
  make: ({ text, ...o }) => mk({ ...o, ...(text === undefined ? {} : { titleMd: text }) }),
  view: taskView,
  create: (text, rows) => create({ title: text, parentId: null }, rows as Task[], clock, idGen(900)).upserts.map(taskView),
  edit: (id, text, rows) => editTitle(id, text, rows as Task[], clock).upserts.map(taskView),
  leave: (how, id, rows) => (how === "done" ? markDone : remove)(id, rows as Task[], clock).upserts.map(taskView),
  undoLeave: (how, before, rows) => applyUndo({ kind: how, before: [before as Task] }, rows as Task[], clock).upserts.map(taskView),
  restore: (id, rows) => restore(id, rows as Task[], clock).upserts.map(taskView),
  expired: (rows, now) => selectTrashExpired(rows as Task[], now, 720),
};

const REMINDER: Kind = {
  name: "reminder",
  make: ({ text, ...o }) => mkReminder({ ...o, ...(text === undefined ? {} : { textMd: text }) }),
  view: reminderView,
  create: (text, rows) => createReminder({ text }, rows as Reminder[], clock, idGen(900)).upserts.map(reminderView),
  edit: (id, text, rows) => editReminderText(id, text, rows as Reminder[], clock).upserts.map(reminderView),
  leave: (how, id, rows) => (how === "done" ? markReminderDone : removeReminder)(id, rows as Reminder[], clock).upserts.map(reminderView),
  undoLeave: (how, before, rows) =>
    applyReminderUndo({ subject: "reminder", kind: how, before: [before as Reminder] }, rows as Reminder[], clock).upserts.map(reminderView),
  restore: (id, rows) => restoreReminder(id, rows as Reminder[], false, clock).upserts.map(reminderView),
  expired: (rows, now) => selectTrashExpiredReminders(rows as Reminder[], now, 720),
};

/** Replaces rows by id with the upserts of a step, as the repository would. */
function applied(kind: Kind, rows: unknown[], upserts: Item[]): unknown[] {
  return rows.map((r) => {
    const u = upserts.find((x) => x.id === kind.view(r).id);
    return u === undefined ? r : { ...(r as object), ...(kind === TASK ? { titleMd: u.text } : { textMd: u.text }), position: u.position, doneAt: u.doneAt, deletedAt: u.deletedAt, prevSiblingId: u.prevSiblingId, nextSiblingId: u.nextSiblingId, updatedAt: u.updatedAt };
  });
}

/** Strips ids and times that differ by construction, keeping what the rule decides. */
const shape = (items: Item[], ids: Map<string, string>) =>
  items.map((i) => ({ ...i, id: ids.get(i.id) ?? "new", prevSiblingId: i.prevSiblingId === null ? null : (ids.get(i.prevSiblingId) ?? "?"), nextSiblingId: i.nextSiblingId === null ? null : (ids.get(i.nextSiblingId) ?? "?") }));

/** Builds rows a, b, c (positions 1, 2, 3) of one kind and a map from their ids to letters. */
function abc(kind: Kind, extra: Partial<Record<"a" | "b" | "c", Partial<Item>>> = {}) {
  const rows = (["a", "b", "c"] as const).map((k, i) => kind.make({ position: i + 1, text: k.toUpperCase(), ...extra[k] }));
  const ids = new Map(rows.map((r, i) => [kind.view(r).id, ["a", "b", "c"][i] ?? "?"]));
  return { rows, ids, id: (k: "a" | "b" | "c") => kind.view(rows[["a", "b", "c"].indexOf(k)]).id };
}

const scenarios: { name: string; run: (kind: Kind) => unknown }[] = [
  { name: "empty and whitespace text create nothing", run: (k) => [k.create("", []), k.create("   ", []), k.create("\n", [])] },
  { name: "line breaks become spaces, surrounding spaces trimmed, markdown kept", run: (k) => k.create("  **Call**\nthe bank ", []).map((i) => i.text) },
  { name: "new items go to the end of the active list", run: (k) => k.create("x", abc(k).rows).map((i) => i.position) },
  {
    name: "unchanged or emptied text saves nothing",
    run: (k) => {
      const { rows, id } = abc(k);
      return [k.edit(id("b"), " B ", rows), k.edit(id("b"), "  ", rows)];
    },
  },
  {
    name: "done and delete record the neighbours",
    run: (k) => {
      const { rows, ids, id } = abc(k);
      return (["done", "delete"] as const).map((how) => shape(k.leave(how, id("b"), rows), ids));
    },
  },
  {
    name: "undo of done and delete puts it back between the same neighbours, even after an add in between",
    run: (k) =>
      (["done", "delete"] as const).map((how) => {
        const { rows, ids, id } = abc(k);
        const before = rows[1];
        let after = applied(k, rows, k.leave(how, id("b"), rows));
        after = [...after, k.make({ position: 1.5, text: "Added" })];
        return shape(k.undoLeave(how, before, after), ids).map((i) => ({ ...i, position: i.position > 1 && i.position < 1.5 }));
      }),
  },
  {
    name: "restore goes after the previous neighbour, else before the next, else to the end",
    run: (k) => {
      const results = [];
      const goneSets: string[][] = [[], ["a"], ["a", "c"]];
      for (const gone of goneSets) {
        const { rows, ids, id } = abc(k, { b: { deletedAt: 10 } });
        const b = rows[1] as object;
        const withNeighbours = rows.map((r, i) => (i === 1 ? { ...b, prevSiblingId: id("a"), nextSiblingId: id("c") } : r));
        const state = withNeighbours.map((r) => (gone.includes(ids.get(k.view(r).id) ?? "") ? { ...(r as object), doneAt: 5 } : r));
        results.push(shape(k.restore(id("b"), state), ids)[0]?.position);
      }
      return results;
    },
  },
  {
    name: "time left reads 30, 1 and 0 days the same way (018: under the Trash cleanup's 30 days)",
    run: () => [0, 29, 30].map((d) => timeLeft(0, d * DAY_MS, { on: true, hours: 720 })),
  },
  {
    name: "the purge takes items deleted exactly 30 × 24 h ago and keeps one deleted 1 ms later",
    run: (k) => {
      const now = 100 * DAY_MS;
      const old = k.make({ deletedAt: now - 30 * DAY_MS });
      const kept = k.make({ deletedAt: now - 30 * DAY_MS + 1 });
      return k.expired([old, kept], now).map((x) => (x === k.view(old).id ? "old" : "kept"));
    },
  },
];

describe("parity of shared rules: top-level task vs reminder (SC-002)", () => {
  for (const s of scenarios) {
    it(s.name, () => {
      const task = s.run(TASK);
      expect(task).not.toEqual(undefined);
      expect(s.run(REMINDER)).toEqual(task);
    });
  }
});

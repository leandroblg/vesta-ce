// T014: the merge's properties (FR-042, research §5), with fast-check. Two installations start from one valid
// snapshot and each makes its own edits at times no other version shares; the properties hold for any such pair.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ExportData, ExportSetting } from "../../../../src/domain/export/format";
import { mergeImport, type LocalData, type MergePlan } from "../../../../src/domain/export/merge";
import type { Reminder } from "../../../../src/domain/reminder";
import { isActive, type Task } from "../../../../src/domain/task";

const RUNS = { numRuns: 500, seed: 20261019 };
const NOW = 9_000_000;

interface Install {
  tasks: Map<string, Task>;
  reminders: Map<string, Reminder>;
  settings: Map<string, ExportSetting>;
}

function task(id: string, parentId: string | null, position: number, t: number, state: "active" | "done" | "deleted"): Task {
  return {
    id,
    parentId,
    titleMd: `${id}@${String(t)}`,
    position,
    createdAt: 100,
    updatedAt: t,
    doneAt: state === "done" ? t : null,
    deletedAt: state === "deleted" ? t : null,
    collapsed: false,
    prevSiblingId: null,
    nextSiblingId: null,
    leftWithId: null,
    keptDoneAt: null,
    alertOverrideMin: null,
    staleBaseAt: 100,
    staleSince: null,
    wasStale: false,
    lastBlinkAt: null,
    firstBlinkCount: null,
    manuallyPositioned: false,
    lastSignalAt: null,
    detailsMd: "",
    rescheduleForMin: null,
  };
}

const state = fc.constantFrom<"active" | "done" | "deleted">("active", "active", "done", "deleted");

/** A valid snapshot: top-level tasks, subtasks under them, no active subtask under an inactive parent. */
const base = fc
  .record({
    tops: fc.array(state, { minLength: 1, maxLength: 6 }),
    subs: fc.array(fc.record({ parent: fc.nat(), state }), { maxLength: 8 }),
    reminders: fc.array(state, { maxLength: 4 }),
  })
  .map(({ tops, subs, reminders }) => {
    const tasks = new Map<string, Task>();
    tops.forEach((s, i) => tasks.set(`t${String(i)}`, task(`t${String(i)}`, null, i + 1, 10, s)));
    subs.forEach((sub, i) => {
      const parent = `t${String(sub.parent % tops.length)}`;
      const parentActive = isActive(tasks.get(parent) as Task);
      const s = parentActive ? sub.state : sub.state === "active" ? "done" : sub.state;
      tasks.set(`s${String(i)}`, task(`s${String(i)}`, parent, i + 1, 10, s));
    });
    const rems = new Map<string, Reminder>();
    reminders.forEach((s, i) => {
      const id = `r${String(i)}`;
      rems.set(id, { id, textMd: id, position: i + 1, createdAt: 100, updatedAt: 10, doneAt: s === "done" ? 10 : null, deletedAt: s === "deleted" ? 10 : null, keptDoneAt: null, prevSiblingId: null, nextSiblingId: null });
    });
    const settings = new Map<string, ExportSetting>([["theme", { key: "theme", value: "system", updatedAt: 0 }]]);
    return { tasks, reminders: rems, settings } satisfies Install;
  });

type Edit =
  | { kind: "title"; pick: number }
  | { kind: "state"; pick: number; to: "active" | "done" | "deleted" }
  | { kind: "move"; pick: number; to: number | null }
  | { kind: "add"; parent: number | null }
  | { kind: "reminder"; pick: number }
  | { kind: "theme"; to: "light" | "dark" };

const edit: fc.Arbitrary<Edit> = fc.oneof(
  fc.record({ kind: fc.constant("title" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("state" as const), pick: fc.nat(), to: state }),
  fc.record({ kind: fc.constant("move" as const), pick: fc.nat(), to: fc.option(fc.nat(), { nil: null }) }),
  fc.record({ kind: fc.constant("add" as const), parent: fc.option(fc.nat(), { nil: null }) }),
  fc.record({ kind: fc.constant("reminder" as const), pick: fc.nat() }),
  fc.record({ kind: fc.constant("theme" as const), to: fc.constantFrom("light" as const, "dark" as const) }),
);

const clone = (i: Install): Install => ({ tasks: new Map(i.tasks), reminders: new Map(i.reminders), settings: new Map(i.settings) });
const sortedTasks = (i: Install) => [...i.tasks.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
const subtasksOf = (i: Install, id: string) => [...i.tasks.values()].filter((t) => t.parentId === id);

/** One edit as the app would make it, keeping the installation valid; `t` is unique to this edit. */
function applyEdit(inst: Install, e: Edit, t: number, side: string): void {
  const all = sortedTasks(inst);
  const pickTask = (n: number) => all[n % all.length] as Task;
  switch (e.kind) {
    case "title": {
      const row = pickTask(e.pick);
      inst.tasks.set(row.id, { ...row, titleMd: `${row.id}@${String(t)}`, updatedAt: t });
      return;
    }
    case "state": {
      const row = pickTask(e.pick);
      const parent = row.parentId === null ? undefined : inst.tasks.get(row.parentId);
      if (e.to === "active" && parent !== undefined && !isActive(parent)) return;
      inst.tasks.set(row.id, { ...row, doneAt: e.to === "done" ? t : null, deletedAt: e.to === "deleted" ? t : null, updatedAt: t });
      if (e.to !== "active") {
        for (const sub of subtasksOf(inst, row.id).filter(isActive)) {
          inst.tasks.set(sub.id, { ...sub, doneAt: e.to === "done" ? t : null, deletedAt: e.to === "deleted" ? t : null, updatedAt: t });
        }
      }
      return;
    }
    case "move": {
      const row = pickTask(e.pick);
      if (subtasksOf(inst, row.id).length > 0) return; // moving a parent with subtasks is not modelled
      const tops = all.filter((x) => x.parentId === null && x.id !== row.id);
      const target = e.to === null || tops.length === 0 ? null : (tops[e.to % tops.length] as Task);
      if (target !== null && isActive(row) && !isActive(target)) return;
      inst.tasks.set(row.id, { ...row, parentId: target?.id ?? null, position: t, updatedAt: t });
      return;
    }
    case "add": {
      const tops = all.filter((x) => x.parentId === null && isActive(x));
      const parent = e.parent === null || tops.length === 0 ? null : (tops[e.parent % tops.length] as Task);
      const id = `${side}${String(t)}`;
      inst.tasks.set(id, task(id, parent?.id ?? null, t, t, "active"));
      return;
    }
    case "reminder": {
      const rows = [...inst.reminders.values()];
      if (rows.length === 0) return;
      const row = rows[e.pick % rows.length] as Reminder;
      inst.reminders.set(row.id, { ...row, textMd: `${row.id}@${String(t)}`, updatedAt: t });
      return;
    }
    case "theme":
      inst.settings.set("theme", { key: "theme", value: e.to, updatedAt: t });
      return;
  }
}

/** Two installations from one snapshot; A's edits get odd times, B's even ones, all above the snapshot's. */
const pair = fc.record({ start: base, a: fc.array(edit, { maxLength: 12 }), b: fc.array(edit, { maxLength: 12 }) }).map(({ start, a, b }) => {
  const A = clone(start);
  const B = clone(start);
  a.forEach((e, i) => {
    applyEdit(A, e, 1001 + 2 * i, "a");
  });
  b.forEach((e, i) => {
    applyEdit(B, e, 1002 + 2 * i, "b");
  });
  return { A, B };
});

const empty = (): Install => ({ tasks: new Map(), reminders: new Map(), settings: new Map() });

function asLocal(i: Install): LocalData {
  return { tasks: [...i.tasks.values()], reminders: [...i.reminders.values()], settings: [...i.settings.values()], assetHashes: new Set() };
}

function asExport(i: Install): ExportData {
  return { appVersion: "x", exportedAt: 0, tasks: [...i.tasks.values()], reminders: [...i.reminders.values()], settings: [...i.settings.values()], assets: [] };
}

/** What main writes: the plan's rows and settings over the local installation. */
function applyPlan(into: Install, plan: MergePlan): Install {
  const out = clone(into);
  for (const t of plan.taskUpserts) out.tasks.set(t.id, t);
  for (const r of plan.reminderUpserts) out.reminders.set(r.id, r);
  for (const s of plan.settingUpserts) out.settings.set(s.key, s);
  return out;
}

const importInto = (into: Install, from: Install, now = NOW) => {
  const plan = mergeImport(asLocal(into), asExport(from), { now, isMac: false });
  return { plan, result: applyPlan(into, plan) };
};

const snapshot = (i: Install) => ({
  tasks: sortedTasks(i),
  reminders: [...i.reminders.values()].sort((a, b) => (a.id < b.id ? -1 : 1)),
  settings: [...i.settings.values()].sort((a, b) => (a.key < b.key ? -1 : 1)),
});

function invariantsHold(i: Install): boolean {
  for (const t of i.tasks.values()) {
    if (t.parentId === null) continue;
    const parent = i.tasks.get(t.parentId);
    if (parent === undefined || parent.parentId !== null) return false; // missing parent, two levels or a loop
    if (isActive(t) && !isActive(parent)) return false;
  }
  return true;
}

describe("mergeImport properties (FR-042)", () => {
  it("exercises the repairs: some generated pairs need each kind", () => {
    const rules = new Set(fc.sample(pair, { numRuns: 2000, seed: RUNS.seed }).flatMap(({ A, B }) => importInto(A, B).plan.repairs.map((r) => r.rule)));
    expect(rules.has("twoLevels")).toBe(true);
    expect(rules.has("activeUnderInactive")).toBe(true);
  });

  it("generates valid installations", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => invariantsHold(A) && invariantsHold(B)),
      RUNS,
    );
  });

  it("is idempotent: importing the same export again changes nothing", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => {
        const first = importInto(A, B).result;
        const again = importInto(first, B, NOW + 1);
        expect(again.plan.counts.added).toBe(0);
        expect(again.plan.counts.updated).toBe(0);
        expect(again.plan.taskUpserts).toEqual([]);
        expect(again.plan.reminderUpserts).toEqual([]);
        expect(again.plan.settingUpserts).toEqual([]);
        expect(snapshot(again.result)).toEqual(snapshot(first));
      }),
      RUNS,
    );
  });

  it("is commutative on the newest updatedAt: A ← B equals B ← A", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => {
        expect(snapshot(importInto(A, B).result)).toEqual(snapshot(importInto(B, A).result));
      }),
      RUNS,
    );
  });

  it("is associative into an empty profile: (∅ ← A) ← B equals (∅ ← B) ← A", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => {
        const ab = importInto(importInto(empty(), A).result, B).result;
        const ba = importInto(importInto(empty(), B).result, A).result;
        expect(snapshot(ab)).toEqual(snapshot(ba));
      }),
      RUNS,
    );
  });

  it("keeps the newest version of every item unless a repair changed it", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => {
        const { plan, result } = importInto(A, B);
        const repaired = new Set(plan.repairs.map((r) => r.id));
        for (const id of new Set([...A.tasks.keys(), ...B.tasks.keys()])) {
          if (repaired.has(id)) continue;
          const a = A.tasks.get(id);
          const b = B.tasks.get(id);
          const newest = a === undefined ? b : b === undefined || a.updatedAt >= b.updatedAt ? a : b;
          expect(result.tasks.get(id)).toEqual(newest);
        }
        for (const id of new Set([...A.reminders.keys(), ...B.reminders.keys()])) {
          const a = A.reminders.get(id);
          const b = B.reminders.get(id);
          const newest = a === undefined ? b : b === undefined || a.updatedAt >= b.updatedAt ? a : b;
          expect(result.reminders.get(id)).toEqual(newest);
        }
      }),
      RUNS,
    );
  });

  it("leaves a valid tree and counts every incoming item once", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => {
        const { plan, result } = importInto(A, B);
        expect(invariantsHold(result)).toBe(true);
        const { added, updated, unchanged } = plan.counts;
        expect(added + updated + unchanged).toBe(B.tasks.size + B.reminders.size);
      }),
      RUNS,
    );
  });

  it("round trip back: A → B → A leaves both installations agreeing", () => {
    fc.assert(
      fc.property(pair, ({ A, B }) => {
        const b1 = importInto(B, A).result;
        const a1 = importInto(A, b1, NOW + 1).result;
        expect(snapshot(a1)).toEqual(snapshot(b1));
      }),
      RUNS,
    );
  });
});

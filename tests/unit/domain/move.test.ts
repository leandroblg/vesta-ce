/** moveTask (004 FR-006 to FR-023; research §3; data-model.md invariants). */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { fixedClock } from "../../../src/domain/clock";
import { markDone, remove, restore } from "../../../src/domain/actions";
import { moveTask, type MoveDest } from "../../../src/domain/move";
import { DomainError, type ChangeSet, type Task } from "../../../src/domain/task";
import { activeSiblings, activeTree } from "../../../src/domain/tree";
import { mk } from "./fixtures";

const HOUR = 3_600_000;
const NOW = 1_000_000_000_000;
const clock = fixedClock(NOW);

/** A task created an hour ago: not stale. */
const fresh = (o: Partial<Task> = {}) => mk({ createdAt: NOW - HOUR, updatedAt: NOW - HOUR, ...o });

/** The rows after a ChangeSet. */
function apply(tasks: readonly Task[], cs: ChangeSet): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const u of cs.upserts) byId.set(u.id, u);
  for (const id of cs.removals) byId.delete(id);
  return [...byId.values()];
}

const move = (tasks: readonly Task[], id: string, dest: MoveDest) => moveTask(id, dest, tasks, clock, DEFAULT_ALERT_SETTINGS);

/** The shown list as titles, subtasks indented. */
function shown(tasks: readonly Task[]): string[] {
  return activeTree(tasks).flatMap((n) => [n.task.titleMd, ...n.subtasks.map((s) => `  ${s.titleMd}`)]);
}

const KEPT = ["createdAt", "staleSince", "staleBaseAt", "wasStale", "lastBlinkAt", "firstBlinkCount", "alertOverrideMin", "titleMd"] as const;

/** Data-model invariant 5: the kept fields of every moved row are unchanged. */
function expectKept(before: readonly Task[], cs: ChangeSet): void {
  const old = new Map(before.map((t) => [t.id, t]));
  for (const u of cs.upserts) {
    const was = old.get(u.id);
    if (was === undefined) continue;
    for (const k of KEPT) expect(u[k]).toEqual(was[k]);
  }
}

describe("US1: same-list reorder", () => {
  it("reorders top-level tasks: C before B gives A, C, B; the moved row gets a midpoint and updatedAt = now", () => {
    const a = fresh({ titleMd: "A", position: 1 });
    const b = fresh({ titleMd: "B", position: 2 });
    const c = fresh({ titleMd: "C", position: 3 });
    const rows = [a, b, c];
    const cs = move(rows, c.id, { kind: "top", beforeId: b.id });
    expect(shown(apply(rows, cs))).toEqual(["A", "C", "B"]);
    expect(cs.upserts).toHaveLength(1);
    expect(cs.upserts[0]).toMatchObject({ id: c.id, position: 1.5, updatedAt: NOW, parentId: null });
    expectKept(rows, cs);
  });

  it("moves a task to the end with beforeId null, and to the start before the first task", () => {
    const a = fresh({ titleMd: "A", position: 1 });
    const b = fresh({ titleMd: "B", position: 2 });
    const c = fresh({ titleMd: "C", position: 3 });
    expect(shown(apply([a, b, c], move([a, b, c], a.id, { kind: "top", beforeId: null })))).toEqual(["B", "C", "A"]);
    expect(shown(apply([a, b, c], move([a, b, c], c.id, { kind: "top", beforeId: a.id })))).toEqual(["C", "A", "B"]);
  });

  it("reorders subtasks within their parent", () => {
    const p = fresh({ titleMd: "P", position: 1 });
    const s1 = fresh({ titleMd: "S1", parentId: p.id, position: 1 });
    const s2 = fresh({ titleMd: "S2", parentId: p.id, position: 2 });
    const s3 = fresh({ titleMd: "S3", parentId: p.id, position: 3 });
    const rows = [p, s1, s2, s3];
    const cs = move(rows, s3.id, { kind: "sub", parentId: p.id, beforeId: s2.id });
    expect(shown(apply(rows, cs))).toEqual(["P", "  S1", "  S3", "  S2"]);
    expectKept(rows, cs);
  });

  it("renumbers under a 1e-9 gap; renumbered siblings keep their updatedAt (FR-020)", () => {
    const a = fresh({ titleMd: "A", position: 1 });
    const b = fresh({ titleMd: "B", position: 1 + 5e-10 });
    const c = fresh({ titleMd: "C", position: 3 });
    const rows = [a, b, c];
    const cs = move(rows, c.id, { kind: "top", beforeId: b.id });
    expect(shown(apply(rows, cs))).toEqual(["A", "C", "B"]);
    const byId = new Map(cs.upserts.map((t) => [t.id, t]));
    expect(byId.get(a.id)).toMatchObject({ position: 1, updatedAt: a.updatedAt });
    expect(byId.get(b.id)).toMatchObject({ position: 3, updatedAt: b.updatedAt });
    expect(byId.get(c.id)).toMatchObject({ position: 2, updatedAt: NOW });
  });

  it("a move to its own place is a no-op: empty ChangeSet (FR-003, FR-020)", () => {
    const a = fresh({ position: 1 });
    const b = fresh({ position: 2 });
    const c = fresh({ position: 3 });
    const rows = [a, b, c];
    expect(move(rows, b.id, { kind: "top", beforeId: b.id })).toEqual({ upserts: [], removals: [] });
    expect(move(rows, b.id, { kind: "top", beforeId: c.id })).toEqual({ upserts: [], removals: [] });
    expect(move(rows, c.id, { kind: "top", beforeId: null })).toEqual({ upserts: [], removals: [] });
    const p = fresh({ position: 4 });
    const s1 = fresh({ parentId: p.id, position: 1 });
    const s2 = fresh({ parentId: p.id, position: 2 });
    expect(move([p, s1, s2], s1.id, { kind: "sub", parentId: p.id, beforeId: s2.id })).toEqual({ upserts: [], removals: [] });
  });

  it("refuses an unknown id (NOT_FOUND), an inactive one and a beforeId that is not an active sibling (INVALID)", () => {
    const a = fresh({ position: 1 });
    const b = fresh({ position: 2 });
    const done = fresh({ position: 3, doneAt: NOW - 1 });
    const p = fresh({ position: 4 });
    const s = fresh({ parentId: p.id, position: 1 });
    const rows = [a, b, done, p, s];
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof DomainError ? e.code : "other";
      }
      return "none";
    };
    expect(code(() => move(rows, "00000000-0000-4000-8000-00000000ffff", { kind: "top", beforeId: null }))).toBe("NOT_FOUND");
    expect(code(() => move(rows, done.id, { kind: "top", beforeId: null }))).toBe("INVALID");
    expect(code(() => move(rows, a.id, { kind: "top", beforeId: done.id }))).toBe("INVALID");
    expect(code(() => move(rows, a.id, { kind: "top", beforeId: s.id }))).toBe("INVALID");
    expect(code(() => move(rows, a.id, { kind: "top", beforeId: "00000000-0000-4000-8000-00000000fffe" }))).toBe("INVALID");
    expect(code(() => move(rows, s.id, { kind: "sub", parentId: p.id, beforeId: a.id }))).toBe("INVALID");
  });

  it("FR-023: a moved task marked done and restored comes back by its new neighbours; so does a moved subtask deleted and restored", () => {
    const a = fresh({ titleMd: "A", position: 1 });
    const b = fresh({ titleMd: "B", position: 2 });
    const c = fresh({ titleMd: "C", position: 3 });
    let rows = apply([a, b, c], move([a, b, c], c.id, { kind: "top", beforeId: b.id }));
    rows = apply(rows, markDone(c.id, rows, clock));
    expect(shown(rows)).toEqual(["A", "B"]);
    rows = apply(rows, restore(c.id, rows, clock));
    expect(shown(rows)).toEqual(["A", "C", "B"]);

    const p = fresh({ titleMd: "P", position: 4 });
    const q = fresh({ titleMd: "Q", position: 5 });
    const s = fresh({ titleMd: "S", parentId: p.id, position: 1 });
    const q1 = fresh({ titleMd: "Q1", parentId: q.id, position: 1 });
    rows = [p, q, s, q1];
    rows = apply(rows, move(rows, s.id, { kind: "sub", parentId: q.id, beforeId: null }));
    rows = apply(rows, remove(s.id, rows, clock));
    rows = apply(rows, restore(s.id, rows, clock));
    expect(shown(rows)).toEqual(["P", "Q", "  Q1", "  S"]);
    expect(activeSiblings(rows, q.id).map((t) => t.titleMd)).toEqual(["Q1", "S"]);
  });
});

/** Data-model invariants 1–4 over the rows after a move. */
function expectInvariants(rows: readonly Task[], cs: ChangeSet): void {
  const active = rows.filter((t) => t.doneAt === null && t.deletedAt === null);
  const byId = new Map(active.map((t) => [t.id, t]));
  for (const t of active) {
    if (t.parentId === null) continue;
    expect(byId.get(t.parentId)?.parentId).toBeNull(); // 1: one level
    expect(active.some((c) => c.parentId === t.id)).toBe(false); // 1: a subtask has no subtasks
    expect(t.manuallyPositioned).toBe(false); // 3
  }
  for (const u of cs.upserts) {
    if (u.parentId !== null) expect(byId.get(u.parentId)?.collapsed).toBe(false); // 4
  }
}

describe("US2: levels", () => {
  it("promotes a subtask to the top level; the old parent keeps the others and loses its toggle when it was the last (FR-011)", () => {
    const p = fresh({ titleMd: "P", position: 1 });
    const q = fresh({ titleMd: "Q", position: 2 });
    const s1 = fresh({ titleMd: "S1", parentId: p.id, position: 1 });
    const s2 = fresh({ titleMd: "S2", parentId: p.id, position: 2 });
    let rows = [p, q, s1, s2];
    let cs = move(rows, s2.id, { kind: "top", beforeId: q.id });
    rows = apply(rows, cs);
    expect(shown(rows)).toEqual(["P", "  S1", "S2", "Q"]);
    expectInvariants(rows, cs);
    cs = move(rows, s1.id, { kind: "top", beforeId: null });
    rows = apply(rows, cs);
    expect(shown(rows)).toEqual(["P", "S2", "Q", "S1"]);
    expect(activeSiblings(rows, p.id)).toHaveLength(0);
  });

  it("demotes a lone task under T", () => {
    const t = fresh({ titleMd: "T", position: 1 });
    const x = fresh({ titleMd: "X", position: 2 });
    const rows = [t, x];
    const cs = move(rows, x.id, { kind: "sub", parentId: t.id, beforeId: null });
    expect(shown(apply(rows, cs))).toEqual(["T", "  X"]);
    expectInvariants(apply(rows, cs), cs);
    expectKept(rows, cs);
  });

  describe("a demoted parent brings its subtasks along as siblings (FR-008)", () => {
    const setup = () => {
      const p = fresh({ titleMd: "P", position: 1 });
      const s1 = fresh({ titleMd: "S1", parentId: p.id, position: 1 });
      const s2 = fresh({ titleMd: "S2", parentId: p.id, position: 2 });
      const x = fresh({ titleMd: "X", position: 2, collapsed: true });
      const x1 = fresh({ titleMd: "X1", parentId: x.id, position: 1 });
      const x2 = fresh({ titleMd: "X2", parentId: x.id, position: 2 });
      return { p, s1, s2, x, x1, x2, rows: [p, s1, s2, x, x1, x2] };
    };

    it("before S2: S1, X, X1, X2, S2", () => {
      const { p, s2, x, rows } = setup();
      const cs = move(rows, x.id, { kind: "sub", parentId: p.id, beforeId: s2.id });
      const after = apply(rows, cs);
      expect(shown(after)).toEqual(["P", "  S1", "  X", "  X1", "  X2", "  S2"]);
      expectInvariants(after, cs);
      expectKept(rows, cs);
    });

    it("at the end: S1, S2, X, X1, X2; the carried subtasks get the new parent and updatedAt = now; X is no longer collapsed (FR-019)", () => {
      const { p, x, x1, x2, rows } = setup();
      const cs = move(rows, x.id, { kind: "sub", parentId: p.id, beforeId: null });
      const after = apply(rows, cs);
      expect(shown(after)).toEqual(["P", "  S1", "  S2", "  X", "  X1", "  X2"]);
      const byId = new Map(cs.upserts.map((t) => [t.id, t]));
      expect(byId.get(x1.id)).toMatchObject({ parentId: p.id, updatedAt: NOW });
      expect(byId.get(x2.id)).toMatchObject({ parentId: p.id, updatedAt: NOW });
      expect(byId.get(x.id)).toMatchObject({ parentId: p.id, collapsed: false, updatedAt: NOW });
    });

    it("after S1 (row 6 gives beforeId S2): S1, X, X1, X2, S2", () => {
      const { p, s2, x, rows } = setup();
      expect(shown(apply(rows, move(rows, x.id, { kind: "sub", parentId: p.id, beforeId: s2.id })))).toEqual(["P", "  S1", "  X", "  X1", "  X2", "  S2"]);
    });
  });

  it("a collapsed target parent is expanded; its updatedAt is unchanged (FR-010)", () => {
    const t = fresh({ titleMd: "T", position: 1, collapsed: true });
    const t1 = fresh({ titleMd: "T1", parentId: t.id, position: 1 });
    const x = fresh({ titleMd: "X", position: 2 });
    const rows = [t, t1, x];
    const cs = move(rows, x.id, { kind: "sub", parentId: t.id, beforeId: null });
    const target = cs.upserts.find((u) => u.id === t.id);
    expect(target).toMatchObject({ collapsed: false, updatedAt: t.updatedAt });
    expect(shown(apply(rows, cs))).toEqual(["T", "  T1", "  X"]);
  });

  it("a parent moved at the top level keeps its collapsed value and its subtasks", () => {
    const a = fresh({ titleMd: "A", position: 1 });
    const x = fresh({ titleMd: "X", position: 2, collapsed: true });
    const x1 = fresh({ titleMd: "X1", parentId: x.id, position: 1 });
    const rows = [a, x, x1];
    const cs = move(rows, x.id, { kind: "top", beforeId: a.id });
    expect(cs.upserts.find((u) => u.id === x.id)?.collapsed).toBe(true);
    expect(activeTree(apply(rows, cs)).map((n) => [n.task.titleMd, n.subtasks.map((s) => s.titleMd)])).toEqual([["X", ["X1"]], ["A", []]]);
  });

  it("refuses nesting a task under itself, under one of its subtasks, under a subtask or an inactive task, or before a carried subtask (FR-009)", () => {
    const x = fresh({ position: 1 });
    const x1 = fresh({ parentId: x.id, position: 1 });
    const p = fresh({ position: 2 });
    const s = fresh({ parentId: p.id, position: 1 });
    const gone = fresh({ position: 3, deletedAt: NOW - 1 });
    const rows = [x, x1, p, s, gone];
    const code = (dest: MoveDest, id = x.id) => {
      try {
        move(rows, id, dest);
      } catch (e) {
        return e instanceof DomainError ? e.code : "other";
      }
      return "none";
    };
    expect(code({ kind: "sub", parentId: x.id, beforeId: null })).toBe("INVALID");
    expect(code({ kind: "sub", parentId: x1.id, beforeId: null })).toBe("INVALID");
    expect(code({ kind: "sub", parentId: s.id, beforeId: null }, p.id)).toBe("INVALID");
    expect(code({ kind: "sub", parentId: gone.id, beforeId: null })).toBe("INVALID");
    expect(code({ kind: "sub", parentId: p.id, beforeId: x1.id })).toBe("INVALID");
  });
});

describe("US3: stale group and the positioned-by-hand mark (FR-013 to FR-016, FR-015a)", () => {
  const DAY = 24 * HOUR;
  /** Stale for a day, sorted by age (pinned) unless positioned by hand. */
  const staleRow = (o: Partial<Task> = {}) =>
    mk({ createdAt: NOW - 2 * DAY, updatedAt: NOW - DAY, staleBaseAt: NOW - 2 * DAY, staleSince: NOW - DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: NOW - DAY + 5, ...o });
  const pinnedIds = (rows: readonly Task[]) => activeTree(rows).filter((n) => n.task.staleSince !== null && !n.task.manuallyPositioned).map((n) => n.task.titleMd);
  const markOf = (cs: ChangeSet, id: string) => cs.upserts.find((u) => u.id === id)?.manuallyPositioned;

  it("set: a stale task dropped at the top level outside the group (from the group or from among manual tasks)", () => {
    const g = staleRow({ titleMd: "G", position: 9 });
    const a = fresh({ titleMd: "A", position: 1 });
    const b = fresh({ titleMd: "B", position: 2 });
    const rows = [g, a, b];
    const cs = move(rows, g.id, { kind: "top", beforeId: b.id });
    expect(markOf(cs, g.id)).toBe(true);
    expect(shown(apply(rows, cs))).toEqual(["A", "G", "B"]);
    const manual = staleRow({ titleMd: "H", position: 3, manuallyPositioned: true });
    const rows2 = [a, b, manual];
    expect(markOf(move(rows2, manual.id, { kind: "top", beforeId: a.id }), manual.id)).toBe(true);
  });

  it("set: a promoted stale subtask; not set: a promoted non-stale subtask", () => {
    const p = fresh({ titleMd: "P", position: 1 });
    const s = staleRow({ titleMd: "S", parentId: p.id, position: 1 });
    const f = fresh({ titleMd: "F", parentId: p.id, position: 2 });
    const rows = [p, s, f];
    expect(markOf(move(rows, s.id, { kind: "top", beforeId: null }), s.id)).toBe(true);
    expect(markOf(move(rows, f.id, { kind: "top", beforeId: null }), f.id)).toBe(false);
  });

  it("unchanged: a non-stale top-level task keeps its mark (a rescheduled one keeps true, others false)", () => {
    const r = fresh({ titleMd: "R", position: 1, manuallyPositioned: true, wasStale: true });
    const a = fresh({ titleMd: "A", position: 2 });
    const b = fresh({ titleMd: "B", position: 3 });
    const rows = [r, a, b];
    expect(markOf(move(rows, r.id, { kind: "top", beforeId: null }), r.id)).toBe(true);
    expect(markOf(move(rows, a.id, { kind: "top", beforeId: r.id }), a.id)).toBe(false);
  });

  it("group, stale: rejoins, unmarked and pinned again; a stale subtask becomes a top-level group task", () => {
    const old = staleRow({ titleMd: "Old", position: 5, createdAt: NOW - 5 * DAY, staleBaseAt: NOW - 5 * DAY });
    const h = staleRow({ titleMd: "H", position: 2, manuallyPositioned: true });
    const a = fresh({ titleMd: "A", position: 1 });
    let rows = [old, h, a];
    expect(shown(rows)).toEqual(["Old", "A", "H"]);
    const cs = move(rows, h.id, { kind: "group" });
    expect(markOf(cs, h.id)).toBe(false);
    rows = apply(rows, cs);
    expect(pinnedIds(rows)).toEqual(["Old", "H"]);
    const p = fresh({ titleMd: "P", position: 3 });
    const s = staleRow({ titleMd: "S", parentId: p.id, position: 1, createdAt: NOW - 3 * DAY, staleBaseAt: NOW - 3 * DAY });
    rows = [...rows, p, s];
    const back = apply(rows, move(rows, s.id, { kind: "group" }));
    expect(pinnedIds(back)).toEqual(["Old", "S", "H"]);
    expect(back.find((t) => t.id === s.id)?.parentId).toBeNull();
  });

  it("group, non-stale: applied as a top-level drop just below the group, mark unchanged", () => {
    const g = staleRow({ titleMd: "G", position: 9 });
    const a = fresh({ titleMd: "A", position: 1 });
    const b = fresh({ titleMd: "B", position: 2, manuallyPositioned: true });
    const rows = [g, a, b];
    const cs = move(rows, b.id, { kind: "group" });
    expect(shown(apply(rows, cs))).toEqual(["G", "B", "A"]);
    expect(markOf(cs, b.id)).toBe(true);
  });

  it("sub: landing as a subtask always clears the mark", () => {
    const t = fresh({ titleMd: "T", position: 1 });
    const h = staleRow({ titleMd: "H", position: 2, manuallyPositioned: true });
    const g = staleRow({ titleMd: "G", position: 3 });
    const rows = [t, h, g];
    expect(markOf(move(rows, h.id, { kind: "sub", parentId: t.id, beforeId: null }), h.id)).toBe(false);
    expect(markOf(move(rows, g.id, { kind: "sub", parentId: t.id, beforeId: null }), g.id)).toBe(false);
  });

  it("stale at release: a task past its threshold whose stale moment is not saved yet counts as stale", () => {
    const late = mk({ titleMd: "Late", createdAt: NOW - 2 * DAY, staleBaseAt: NOW - 2 * DAY, position: 3 });
    const a = fresh({ titleMd: "A", position: 1 });
    const rows = [a, late];
    expect(markOf(move(rows, late.id, { kind: "top", beforeId: a.id }), late.id)).toBe(true);
  });

  it("a rejoin of a task already in the group is empty; a rejoin that changes only the mark is saved with updatedAt = now (FR-020)", () => {
    const g = staleRow({ titleMd: "G", position: 1 });
    expect(move([g], g.id, { kind: "group" })).toEqual({ upserts: [], removals: [] });
    const h = staleRow({ titleMd: "H", position: 1, manuallyPositioned: true });
    const cs = move([h], h.id, { kind: "group" });
    expect(cs.upserts[0]).toMatchObject({ id: h.id, manuallyPositioned: false, updatedAt: NOW });
  });

  it("refuses a top-level beforeId that names a pinned task (INVALID)", () => {
    const g = staleRow({ position: 1 });
    const a = fresh({ position: 2 });
    expect(() => move([g, a], a.id, { kind: "top", beforeId: g.id })).toThrow(DomainError);
  });

  it("FR-016: a dragged stale task keeps its place after a reschedule and after going stale again", async () => {
    const { reschedule } = await import("../../../src/domain/actions");
    const { evaluateAlerts } = await import("../../../src/domain/alerts");
    const g = staleRow({ titleMd: "G", position: 9 });
    // A 10-day override keeps A and B from going stale before G does again.
    const a = fresh({ titleMd: "A", position: 1, alertOverrideMin: 14_400 });
    const b = fresh({ titleMd: "B", position: 2, alertOverrideMin: 14_400 });
    let rows = apply([g, a, b], move([g, a, b], g.id, { kind: "top", beforeId: b.id }));
    expect(shown(rows)).toEqual(["A", "G", "B"]);
    rows = apply(rows, reschedule(g.id, rows, clock, DEFAULT_ALERT_SETTINGS));
    expect(shown(rows)).toEqual(["A", "G", "B"]);
    const later = NOW + DAY + HOUR;
    rows = apply(rows, { upserts: evaluateAlerts({ tasks: rows, settings: DEFAULT_ALERT_SETTINGS, now: later, visibility: { visible: true, visibleSince: NOW } }).upserts, removals: [] });
    expect(rows.find((t) => t.id === g.id)?.staleSince).not.toBeNull();
    expect(shown(rows)).toEqual(["A", "G", "B"]);
  });

  it("US3-3a: with an empty group F may go first; a task going stale later shows above F", async () => {
    const { evaluateAlerts } = await import("../../../src/domain/alerts");
    const a = fresh({ titleMd: "A", position: 1 });
    const f = fresh({ titleMd: "F", position: 2 });
    const old = mk({ titleMd: "Old", position: 3, createdAt: NOW - 23 * HOUR, staleBaseAt: NOW - 23 * HOUR });
    let rows = apply([a, f, old], move([a, f, old], f.id, { kind: "top", beforeId: a.id }));
    expect(shown(rows)).toEqual(["F", "A", "Old"]);
    const later = NOW + 2 * HOUR;
    rows = apply(rows, { upserts: evaluateAlerts({ tasks: rows, settings: DEFAULT_ALERT_SETTINGS, now: later, visibility: { visible: true, visibleSince: NOW } }).upserts, removals: [] });
    expect(shown(rows)).toEqual(["Old", "F", "A"]);
  });
});

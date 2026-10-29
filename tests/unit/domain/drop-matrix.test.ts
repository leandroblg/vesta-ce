/**
 * SC-001: the combination matrix (004 T048). Dragged kinds × positions × targets, generated over a list
 * built from real rows. Each case resolves a drop, applies it with moveTask, and checks the result against
 * the spec's rules (FR-006 to FR-015a). It runs after the code by design: it only adds coverage over rules
 * whose own failing tests were written first (drop-rules.test.ts, move.test.ts), so constitution IV holds.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { crossedThreshold, isPinned } from "../../../src/domain/alerts";
import { fixedClock } from "../../../src/domain/clock";
import { resolveDrop, type DraggedItem, type LayoutRow } from "../../../src/domain/drop-rules";
import { moveTask } from "../../../src/domain/move";
import { isActive, type Task } from "../../../src/domain/task";
import { activeTree } from "../../../src/domain/tree";
import { mk } from "./fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_000_000_000_000;
const clock = fixedClock(NOW);
const LONG = 14_400;

const fresh = (o: Partial<Task> = {}) => mk({ createdAt: NOW - HOUR, alertOverrideMin: LONG, ...o });
const stale = (age: number, o: Partial<Task> = {}) =>
  mk({ createdAt: NOW - age, staleBaseAt: NOW - age, staleSince: NOW - age + DAY, wasStale: true, firstBlinkCount: 3, lastBlinkAt: NOW - HOUR, ...o });

/** A list with every kind of target: an expanded and a collapsed group task, expanded, collapsed and plain manual tasks. */
function world(withGroup: boolean) {
  const rows: Task[] = [];
  const add = (t: Task) => (rows.push(t), t);
  if (withGroup) {
    const g1 = add(stale(5 * DAY, { titleMd: "G1", position: 50 }));
    add(fresh({ titleMd: "G1a", parentId: g1.id, position: 1 }));
    const g2 = add(stale(4 * DAY, { titleMd: "G2", position: 51, collapsed: true }));
    add(fresh({ titleMd: "G2a", parentId: g2.id, position: 1 }));
    add(stale(3 * DAY, { titleMd: "G3", position: 52 }));
  }
  const m1 = add(fresh({ titleMd: "M1", position: 1 }));
  add(fresh({ titleMd: "M1a", parentId: m1.id, position: 1 }));
  add(stale(2 * DAY, { titleMd: "St", parentId: m1.id, position: 2 }));
  const m2 = add(fresh({ titleMd: "M2", position: 2, collapsed: true }));
  add(fresh({ titleMd: "M2a", parentId: m2.id, position: 1 }));
  add(stale(2 * DAY, { titleMd: "H", position: 3, manuallyPositioned: true }));
  add(fresh({ titleMd: "R", position: 4, manuallyPositioned: true, wasStale: true }));
  add(fresh({ titleMd: "M3", position: 5 }));
  return rows;
}

/** The layout as shown (collapsed subtasks hidden), 40 px cards, 8 px gaps. */
function layoutOf(rows: readonly Task[]): LayoutRow[] {
  const out: LayoutRow[] = [];
  const push = (r: Omit<LayoutRow, "top" | "height" | "lastInGroup">) => out.push({ ...r, top: out.length * 48, height: 40, lastInGroup: false });
  for (const { task, subtasks } of activeTree(rows)) {
    const shown = task.collapsed ? [] : subtasks;
    push({ key: task.id, kind: "task", id: task.id, parentId: null, expandedParent: shown.length > 0, inGroup: isPinned(task) });
    for (const s of shown) push({ key: s.id, kind: "sub", id: s.id, parentId: task.id, expandedParent: false, inGroup: false });
  }
  push({ key: "new-task", kind: "new-task", id: null, parentId: null, expandedParent: false, inGroup: false });
  const group = out.filter((r) => r.inGroup);
  const last = group[group.length - 1];
  if (last !== undefined) last.lastInGroup = true;
  return out;
}

/** The dragged kinds of SC-001 (a), by title. */
const DRAGGED = ["M3", "M1", "M2", "G1", "G2", "H", "R", "M1a", "St"] as const;
const FRACTIONS = [0.1, 0.5, 0.9];

/**
 * Combinations that cannot occur, with the reason (SC-001 "listed as excluded"):
 * - a subtask hidden in a collapsed parent (G2a, M2a) cannot be dragged or hovered: it is not shown;
 * - a group task's subtask dragged into its own parent's area is an ordinary subtask move, covered;
 * - G1 and G2 do not exist in the empty-group list.
 */
const EXCLUDED = ["G2a", "M2a"];

interface Case {
  group: boolean;
  dragged: string;
  /** Index of the hovered row in the shown list. */
  row: number;
  f: number;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const group of [true, false]) {
    const rows = world(group);
    const titles = new Set(rows.map((t) => t.titleMd));
    const shown = layoutOf(rows);
    for (const dragged of DRAGGED) {
      if (!titles.has(dragged) || EXCLUDED.includes(dragged)) continue;
      shown.forEach((_, row) => {
        for (const f of FRACTIONS) out.push({ group, dragged, row, f });
      });
    }
  }
  return out;
}

describe("SC-001 combination matrix", () => {
  const all = cases();

  it("covers every dragged kind against every shown row and zone, with and without a stale group", () => {
    expect(all.length).toBeGreaterThan(300);
  });

  it("each drop gives a destination whose move follows the drop table, the stale group rules and the mark table", () => {
    let moved = 0;
    let none = 0;
    for (const c of all) {
      const rows = world(c.group);
      const layout = layoutOf(rows);
      const byTitle = new Map(rows.map((t) => [t.titleMd, t]));
      const d = byTitle.get(c.dragged) as Task;
      const isStale = d.staleSince !== null || crossedThreshold(d, DEFAULT_ALERT_SETTINGS, NOW);
      const item: DraggedItem = { id: d.id, parentId: d.parentId, isParent: rows.some((t) => t.parentId === d.id && isActive(t)), stale: isStale };
      const row = layout[c.row] as LayoutRow;
      const label = `${c.group ? "group" : "no group"}: ${c.dragged} over ${byTitle.get(row.key)?.titleMd ?? row.key} at ${String(c.f)}`;
      const result = resolveDrop(layout, row.top + row.height * c.f, item);
      if (result === null) {
        none++;
        continue;
      }
      const { dest, indicator } = result;
      // The indicator matches the destination (FR-012).
      if (dest.kind === "group") expect(indicator, label).toEqual({ kind: "group" });
      if (dest.kind === "top") expect(indicator, label).toMatchObject({ kind: "line", indent: "top" });
      if (dest.kind === "sub") expect(["card", "line"], label).toContain(indicator.kind);
      if (indicator.kind === "card") expect(dest, label).toMatchObject({ kind: "sub", parentId: indicator.rowKey, beforeId: null });
      // Only a stale item rejoins (FR-013); no top-level beforeId names a pinned task.
      if (dest.kind === "group") expect(isStale, label).toBe(true);
      if (dest.kind === "top" && dest.beforeId !== null) expect(isPinned(rows.find((t) => t.id === dest.beforeId) as Task), label).toBe(false);
      // Never under itself or under a subtask (FR-009).
      if (dest.kind === "sub") {
        expect(dest.parentId, label).not.toBe(d.id);
        expect(rows.find((t) => t.id === dest.parentId)?.parentId, label).toBeNull();
      }

      const cs = moveTask(d.id, dest, rows, clock, DEFAULT_ALERT_SETTINGS);
      const after = rows.map((t) => cs.upserts.find((u) => u.id === t.id) ?? t);
      const m = after.find((t) => t.id === d.id) as Task;
      if (cs.upserts.length > 0) moved++;
      // Parent and mark (FR-006, FR-015a).
      if (dest.kind === "sub") {
        expect(m.parentId, label).toBe(dest.parentId);
        expect(m.manuallyPositioned, label).toBe(false);
        expect(after.find((t) => t.id === dest.parentId)?.collapsed, label).toBe(false);
      } else if (dest.kind === "top") {
        expect(m.parentId, label).toBeNull();
        const expected = isStale ? true : d.parentId === null ? d.manuallyPositioned : false;
        if (cs.upserts.length > 0) expect(m.manuallyPositioned, label).toBe(expected);
      } else {
        expect(m.parentId, label).toBeNull();
        expect(isPinned(m), label).toBe(true);
      }
      // The stale group is always on top (FR-013, Q105): no non-pinned task before a pinned one.
      const tops = activeTree(after).map((n) => n.task);
      const firstManual = tops.findIndex((t) => !isPinned(t));
      if (firstManual >= 0) expect(tops.slice(firstManual).some((t) => isPinned(t)), label).toBe(false);
      // One level (FR-009), and a demoted parent's subtasks follow it (FR-008).
      for (const t of after.filter(isActive)) {
        if (t.parentId === null) continue;
        expect(after.find((p) => p.id === t.parentId)?.parentId, label).toBeNull();
        expect(after.some((c2) => isActive(c2) && c2.parentId === t.id), label).toBe(false);
      }
      // Kept fields (FR-019).
      for (const k of ["createdAt", "staleSince", "wasStale", "titleMd", "alertOverrideMin"] as const) expect(m[k], label).toEqual(d[k]);
    }
    expect(moved).toBeGreaterThan(150);
    expect(none).toBeGreaterThan(20);
  });
});

/** Keyboard moves (004 FR-024 to FR-026; research §4): the key → the same destinations a drop gives. */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { fixedClock } from "../../../src/domain/clock";
import { keyboardDest, moveTask, positionInList } from "../../../src/domain/move";
import { keyboardReminderDest } from "../../../src/domain/reminder-actions";
import type { Task } from "../../../src/domain/task";
import { activeTree } from "../../../src/domain/tree";
import { mk, mkReminder } from "./fixtures";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_000_000_000_000;
const fresh = (o: Partial<Task> = {}) => mk({ createdAt: NOW - HOUR, ...o });
const staleRow = (o: Partial<Task> = {}) => mk({ createdAt: NOW - 2 * DAY, staleBaseAt: NOW - 2 * DAY, staleSince: NOW - DAY, wasStale: true, ...o });

describe("keyboardDest: top level (FR-024)", () => {
  const a = fresh({ titleMd: "A", position: 1 });
  const b = fresh({ titleMd: "B", position: 2 });
  const c = fresh({ titleMd: "C", position: 3 });
  const rows = [a, b, c];

  it("up goes before the previous task; down goes before the task after the next one (null at the end)", () => {
    expect(keyboardDest(b.id, "up", rows)).toEqual({ kind: "top", beforeId: a.id });
    expect(keyboardDest(a.id, "down", rows)).toEqual({ kind: "top", beforeId: c.id });
    expect(keyboardDest(b.id, "down", rows)).toEqual({ kind: "top", beforeId: null });
  });

  it("does nothing at the edges", () => {
    expect(keyboardDest(a.id, "up", rows)).toBeNull();
    expect(keyboardDest(c.id, "down", rows)).toBeNull();
  });

  it("a parent moves as one, past the whole of a neighbouring parent (FR-026)", () => {
    const p = fresh({ titleMd: "P", position: 1 });
    const p1 = fresh({ titleMd: "P1", parentId: p.id, position: 1 });
    const q = fresh({ titleMd: "Q", position: 2 });
    const list = [p, p1, q];
    const dest = keyboardDest(q.id, "up", list);
    expect(dest).toEqual({ kind: "top", beforeId: p.id });
    const after = moveTask(q.id, dest ?? { kind: "group" }, list, fixedClock(NOW), DEFAULT_ALERT_SETTINGS).upserts;
    const rowsAfter = list.map((t) => after.find((u) => u.id === t.id) ?? t);
    expect(activeTree(rowsAfter).map((n) => [n.task.titleMd, n.subtasks.map((s) => s.titleMd)])).toEqual([["Q", []], ["P", ["P1"]]]);
  });
});

describe("keyboardDest: subtasks (FR-024)", () => {
  const p = fresh({ titleMd: "P", position: 1 });
  const s1 = fresh({ titleMd: "S1", parentId: p.id, position: 1 });
  const s2 = fresh({ titleMd: "S2", parentId: p.id, position: 2 });
  const s3 = fresh({ titleMd: "S3", parentId: p.id, position: 3 });
  const rows = [p, s1, s2, s3];

  it("moves within the parent and stops at its edges", () => {
    expect(keyboardDest(s2.id, "up", rows)).toEqual({ kind: "sub", parentId: p.id, beforeId: s1.id });
    expect(keyboardDest(s1.id, "down", rows)).toEqual({ kind: "sub", parentId: p.id, beforeId: s3.id });
    expect(keyboardDest(s2.id, "down", rows)).toEqual({ kind: "sub", parentId: p.id, beforeId: null });
    expect(keyboardDest(s1.id, "up", rows)).toBeNull();
    expect(keyboardDest(s3.id, "down", rows)).toBeNull();
  });
});

describe("keyboardDest: demote and promote (FR-024a, FR-024b)", () => {
  it("demote: under the previous top-level task as shown, even with its subtasks shown between, or when it is pinned", () => {
    const p = fresh({ titleMd: "P", position: 1 });
    const p1 = fresh({ titleMd: "P1", parentId: p.id, position: 1 });
    const x = fresh({ titleMd: "X", position: 2 });
    expect(keyboardDest(x.id, "demote", [p, p1, x])).toEqual({ kind: "sub", parentId: p.id, beforeId: null });
    const g = staleRow({ titleMd: "G", position: 9 });
    const m = fresh({ titleMd: "M", position: 1 });
    expect(keyboardDest(m.id, "demote", [g, m])).toEqual({ kind: "sub", parentId: g.id, beforeId: null });
  });

  it("demote does nothing for the first top-level task or a subtask; promote nothing for a top-level task", () => {
    const a = fresh({ position: 1 });
    const s = fresh({ parentId: a.id, position: 1 });
    expect(keyboardDest(a.id, "demote", [a, s])).toBeNull();
    expect(keyboardDest(s.id, "demote", [a, s])).toBeNull();
    expect(keyboardDest(a.id, "promote", [a, s])).toBeNull();
  });

  it("promote: right after the parent in the manual order (null at the end); just below the group when the parent is pinned", () => {
    const p = fresh({ titleMd: "P", position: 1 });
    const s = fresh({ titleMd: "S", parentId: p.id, position: 1 });
    const q = fresh({ titleMd: "Q", position: 2 });
    expect(keyboardDest(s.id, "promote", [p, s, q])).toEqual({ kind: "top", beforeId: q.id });
    expect(keyboardDest(s.id, "promote", [p, s])).toEqual({ kind: "top", beforeId: null });
    const g = staleRow({ titleMd: "G", position: 9 });
    const gs = fresh({ titleMd: "GS", parentId: g.id, position: 1 });
    const m = fresh({ titleMd: "M", position: 1 });
    expect(keyboardDest(gs.id, "promote", [g, gs, m])).toEqual({ kind: "top", beforeId: m.id });
  });
});

describe("keyboardDest: next to the stale group (FR-025)", () => {
  const g1 = staleRow({ titleMd: "G1", createdAt: NOW - 4 * DAY, staleBaseAt: NOW - 4 * DAY, position: 10 });
  const g2 = staleRow({ titleMd: "G2", position: 11 });
  const m1 = fresh({ titleMd: "M1", position: 1 });
  const m2 = fresh({ titleMd: "M2", position: 2 });
  const m3 = fresh({ titleMd: "M3", position: 3 });

  it("up on the first task below the group: nothing if it is not stale; rejoin if it is positioned by hand and stale", () => {
    expect(keyboardDest(m1.id, "up", [g1, g2, m1, m2])).toBeNull();
    const h = staleRow({ titleMd: "H", position: 0, manuallyPositioned: true });
    expect(keyboardDest(h.id, "up", [g1, g2, h, m1])).toEqual({ kind: "group" });
    // Also with an empty group: it is then the first top-level task.
    expect(keyboardDest(h.id, "up", [h, m1])).toEqual({ kind: "group" });
  });

  it("up on a group task does nothing", () => {
    expect(keyboardDest(g2.id, "up", [g1, g2, m1])).toBeNull();
    expect(keyboardDest(g1.id, "up", [g1, g2, m1])).toBeNull();
  });

  it("down on a group task: right after the first task below the group, or the end", () => {
    expect(keyboardDest(g1.id, "down", [g1, g2, m1, m2, m3])).toEqual({ kind: "top", beforeId: m2.id });
    expect(keyboardDest(g1.id, "down", [g1, g2, m1])).toEqual({ kind: "top", beforeId: null });
    // No task below the group: the end, unless it is already the last group task.
    expect(keyboardDest(g1.id, "down", [g1, g2])).toEqual({ kind: "top", beforeId: null });
    expect(keyboardDest(g2.id, "down", [g1, g2])).toBeNull();
  });
});

describe("keyboardReminderDest (FR-024)", () => {
  const r1 = mkReminder({ position: 1 });
  const r2 = mkReminder({ position: 2 });
  const r3 = mkReminder({ position: 3 });
  const rows = [r1, r2, r3];

  it("up and down among reminders; nothing at the edges or for promote and demote", () => {
    expect(keyboardReminderDest(r2.id, "up", rows)).toBe(r1.id);
    expect(keyboardReminderDest(r1.id, "down", rows)).toBe(r3.id);
    expect(keyboardReminderDest(r2.id, "down", rows)).toBeNull();
    expect(keyboardReminderDest(r1.id, "up", rows)).toBeUndefined();
    expect(keyboardReminderDest(r3.id, "down", rows)).toBeUndefined();
    expect(keyboardReminderDest(r2.id, "promote", rows)).toBeUndefined();
    expect(keyboardReminderDest(r2.id, "demote", rows)).toBeUndefined();
  });
});

describe("positionInList (FR-027)", () => {
  it("gives position N of M in the shown list, counting the stale group, and the parent for a subtask", () => {
    const g = staleRow({ titleMd: "G", position: 9 });
    const p = fresh({ titleMd: "Plan budget", position: 1 });
    const s1 = fresh({ titleMd: "S1", parentId: p.id, position: 1 });
    const s2 = fresh({ titleMd: "S2", parentId: p.id, position: 2 });
    const rows = [g, p, s1, s2];
    expect(positionInList(g.id, rows)).toEqual({ n: 1, m: 2, parentTitle: null });
    expect(positionInList(p.id, rows)).toEqual({ n: 2, m: 2, parentTitle: null });
    expect(positionInList(s2.id, rows)).toEqual({ n: 2, m: 2, parentTitle: "Plan budget" });
  });
});

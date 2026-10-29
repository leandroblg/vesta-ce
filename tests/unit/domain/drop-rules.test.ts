/**
 * Drop resolution (004 FR-006 to FR-013, FR-017; research §2). Layouts are literal: 40 px cards with
 * 8 px gaps, so row i spans [48i, 48i + 40] and the line between rows i and i+1 sits at 48i + 44.
 */
import { describe, expect, it } from "vitest";
import { resolveDrop, resolveReminderDrop, type DraggedItem, type LayoutRow } from "../../../src/domain/drop-rules";

const H = 40;
const PITCH = 48;

interface RowSpec {
  key: string;
  kind?: LayoutRow["kind"];
  parentId?: string;
  expanded?: boolean;
  group?: boolean;
}

function layout(specs: readonly RowSpec[]): LayoutRow[] {
  const rows = specs.map((s, i): LayoutRow => {
    const kind = s.kind ?? (s.parentId !== undefined ? "sub" : "task");
    const isCard = kind === "new-task" || kind === "new-rem";
    return {
      key: s.key,
      kind,
      id: isCard ? null : s.key,
      parentId: s.parentId ?? null,
      top: i * PITCH,
      height: H,
      expandedParent: s.expanded === true,
      inGroup: s.group === true,
      lastInGroup: false,
    };
  });
  const groupRows = rows.filter((r) => r.inGroup);
  const last = groupRows[groupRows.length - 1];
  if (last !== undefined) last.lastInGroup = true;
  return rows;
}

/** y at a fraction of a row's height. */
function at(rows: readonly LayoutRow[], key: string, f: number): number {
  const row = rows.find((r) => r.key === key);
  if (row === undefined) throw new Error(`no row ${key}`);
  return row.top + row.height * f;
}
const UPPER = 0.1;
const MIDDLE = 0.5;
const LOWER = 0.9;

/** The line between row i and row i+1. */
const lineAfter = (i: number) => i * PITCH + 44;

const drag = (id: string, o: Partial<DraggedItem> = {}): DraggedItem => ({ id, parentId: null, isParent: false, stale: false, ...o });

// A, B, C top level; P expanded with S1–S3; the empty "new task" card.
const L1 = layout([
  { key: "A" },
  { key: "B" },
  { key: "C" },
  { key: "P", expanded: true },
  { key: "S1", parentId: "P" },
  { key: "S2", parentId: "P" },
  { key: "S3", parentId: "P" },
  { key: "new-task", kind: "new-task" },
]);

describe("US1: same-list reorder (FR-006 rows 1 and 4, FR-007, FR-009a)", () => {
  describe("zones (FR-007)", () => {
    it("just under 28% is the upper part and just over 72% the lower part", () => {
      expect(resolveDrop(L1, at(L1, "A", 0.2799), drag("C"))?.dest).toEqual({ kind: "top", beforeId: "A" });
      expect(resolveDrop(L1, at(L1, "A", 0.7201), drag("C"))?.dest).toEqual({ kind: "top", beforeId: "B" });
    });

    it("a pointer in the gap between two cards belongs to the nearer card", () => {
      expect(resolveDrop(L1, 42, drag("C"))?.dest).toEqual({ kind: "top", beforeId: "B" });
      expect(resolveDrop(L1, 46, drag("C"))?.dest).toEqual({ kind: "top", beforeId: "B" });
    });

    it("above the first card is its upper part; past the last card is the last card", () => {
      expect(resolveDrop(L1, -20, drag("C"))?.dest).toEqual({ kind: "top", beforeId: "A" });
      expect(resolveDrop(L1, 2000, drag("C"))?.dest).toEqual({ kind: "top", beforeId: null });
    });
  });

  describe("top level (row 4)", () => {
    it("the upper part of a task is the gap above it, the lower part the gap below it, with a top-indent line", () => {
      expect(resolveDrop(L1, at(L1, "A", UPPER), drag("C"))).toEqual({
        dest: { kind: "top", beforeId: "A" },
        indicator: { kind: "line", y: -4, indent: "top" },
      });
      expect(resolveDrop(L1, at(L1, "A", LOWER), drag("C"))).toEqual({
        dest: { kind: "top", beforeId: "B" },
        indicator: { kind: "line", y: lineAfter(0), indent: "top" },
      });
      expect(resolveDrop(L1, at(L1, "B", UPPER), drag("C"))?.dest).toEqual({ kind: "top", beforeId: "B" });
    });

    it("the empty new-task card is one zone: the end of the top level", () => {
      for (const f of [UPPER, MIDDLE, LOWER]) {
        expect(resolveDrop(L1, at(L1, "new-task", f), drag("A"))).toEqual({
          dest: { kind: "top", beforeId: null },
          indicator: { kind: "line", y: lineAfter(6), indent: "top" },
        });
      }
    });
  });

  describe("subtasks (row 1, within their parent)", () => {
    it("the upper part of a subtask is before it; its lower part is before the next one, or the end", () => {
      const s3 = drag("S3", { parentId: "P" });
      expect(resolveDrop(L1, at(L1, "S1", UPPER), s3)).toEqual({
        dest: { kind: "sub", parentId: "P", beforeId: "S1" },
        indicator: { kind: "line", y: lineAfter(3), indent: "sub" },
      });
      expect(resolveDrop(L1, at(L1, "S1", LOWER), s3)).toEqual({
        dest: { kind: "sub", parentId: "P", beforeId: "S2" },
        indicator: { kind: "line", y: lineAfter(4), indent: "sub" },
      });
      const s1 = drag("S1", { parentId: "P" });
      expect(resolveDrop(L1, at(L1, "S3", LOWER), s1)).toEqual({
        dest: { kind: "sub", parentId: "P", beforeId: null },
        indicator: { kind: "line", y: lineAfter(6), indent: "sub" },
      });
    });
  });

  describe("own place (FR-009a)", () => {
    it("the gaps directly above and below a top-level task give no move", () => {
      expect(resolveDrop(L1, at(L1, "B", LOWER), drag("C"))).toBeNull();
      expect(resolveDrop(L1, at(L1, "C", UPPER), drag("C"))).toBeNull();
      expect(resolveDrop(L1, at(L1, "C", LOWER), drag("C"))).toBeNull();
    });

    it("the gaps directly above and below a subtask give no move", () => {
      const s2 = drag("S2", { parentId: "P" });
      expect(resolveDrop(L1, at(L1, "S1", LOWER), s2)).toBeNull();
      expect(resolveDrop(L1, at(L1, "S2", UPPER), s2)).toBeNull();
      expect(resolveDrop(L1, at(L1, "S2", LOWER), s2)).toBeNull();
      expect(resolveDrop(L1, at(L1, "S3", UPPER), s2)).toBeNull();
    });

    it("the last top-level task dropped on the empty card stays where it is", () => {
      const L = layout([{ key: "A" }, { key: "B" }, { key: "new-task", kind: "new-task" }]);
      expect(resolveDrop(L, at(L, "new-task", MIDDLE), drag("B"))).toBeNull();
    });
  });
});

describe("reminders (FR-017)", () => {
  const R = layout([
    { key: "R1", kind: "rem" },
    { key: "R2", kind: "rem" },
    { key: "R3", kind: "rem" },
    { key: "new-rem", kind: "new-rem" },
  ]);

  it("the upper half of a reminder is before it, the lower half before the next one", () => {
    expect(resolveReminderDrop(R, at(R, "R1", 0.49), "R3")).toEqual({ beforeId: "R1", indicator: { kind: "line", y: -4, indent: "top" } });
    expect(resolveReminderDrop(R, at(R, "R1", 0.51), "R3")).toEqual({
      beforeId: "R2",
      indicator: { kind: "line", y: lineAfter(0), indent: "top" },
    });
  });

  it("the empty card (or the maximum card, also a new-rem row) makes the reminder the last one", () => {
    expect(resolveReminderDrop(R, at(R, "new-rem", MIDDLE), "R1")).toEqual({
      beforeId: null,
      indicator: { kind: "line", y: lineAfter(2), indent: "top" },
    });
  });

  it("its own place gives no move", () => {
    expect(resolveReminderDrop(R, at(R, "R2", LOWER), "R3")).toBeNull();
    expect(resolveReminderDrop(R, at(R, "R3", UPPER), "R3")).toBeNull();
    expect(resolveReminderDrop(R, at(R, "new-rem", MIDDLE), "R3")).toBeNull();
  });
});

// P expanded with S1, S2; Q top-level; the empty card.
const L3 = layout([
  { key: "P", expanded: true },
  { key: "S1", parentId: "P" },
  { key: "S2", parentId: "P" },
  { key: "Q" },
  { key: "new-task", kind: "new-task" },
]);
// A; Q collapsed (its subtasks hidden); B; the empty card.
const L2 = layout([{ key: "A" }, { key: "Q" }, { key: "B" }, { key: "new-task", kind: "new-task" }]);

describe("US2: levels (FR-006 rows 1, 2, 3, 5, 6; FR-007; FR-009, FR-009a)", () => {
  it("row 1: the lower part of an expanded parent is the gap above its first subtask (subtask indent)", () => {
    expect(resolveDrop(L1, at(L1, "P", LOWER), drag("A"))).toEqual({
      dest: { kind: "sub", parentId: "P", beforeId: "S1" },
      indicator: { kind: "line", y: lineAfter(3), indent: "sub" },
    });
  });

  it("FR-007: the lower part of a collapsed parent is the top-level gap after it", () => {
    expect(resolveDrop(L2, at(L2, "Q", LOWER), drag("A"))).toEqual({
      dest: { kind: "top", beforeId: "B" },
      indicator: { kind: "line", y: lineAfter(1), indent: "top" },
    });
  });

  it("rows 2 and 3: the gap after a last subtask: its middle and lower parts → last subtask; the next card's upper part → top level", () => {
    for (const f of [MIDDLE, LOWER]) {
      expect(resolveDrop(L3, at(L3, "S2", f), drag("Q"))).toEqual({
        dest: { kind: "sub", parentId: "P", beforeId: null },
        indicator: { kind: "line", y: lineAfter(2), indent: "sub" },
      });
    }
    const L = layout([{ key: "P", expanded: true }, { key: "S1", parentId: "P" }, { key: "S2", parentId: "P" }, { key: "Q" }, { key: "R" }, { key: "new-task", kind: "new-task" }]);
    expect(resolveDrop(L, at(L, "Q", UPPER), drag("R"))).toEqual({
      dest: { kind: "top", beforeId: "Q" },
      indicator: { kind: "line", y: lineAfter(2), indent: "top" },
    });
    // The next card is the empty card: its whole area is the top-level end (row 3 there).
    expect(resolveDrop(L1, at(L1, "new-task", UPPER), drag("A"))?.dest).toEqual({ kind: "top", beforeId: null });
  });

  it("row 5: the middle of a top-level card → a subtask of it (its last), with the card outlined", () => {
    expect(resolveDrop(L1, at(L1, "A", MIDDLE), drag("C"))).toEqual({ dest: { kind: "sub", parentId: "A", beforeId: null }, indicator: { kind: "card", rowKey: "A" } });
    expect(resolveDrop(L1, at(L1, "P", MIDDLE), drag("C"))).toEqual({ dest: { kind: "sub", parentId: "P", beforeId: null }, indicator: { kind: "card", rowKey: "P" } });
    expect(resolveDrop(L2, at(L2, "Q", MIDDLE), drag("A"))).toEqual({ dest: { kind: "sub", parentId: "Q", beforeId: null }, indicator: { kind: "card", rowKey: "Q" } });
  });

  it("FR-007: exactly 28% and exactly 72% belong to the middle part", () => {
    expect(resolveDrop(L1, at(L1, "A", 0.28), drag("C"))?.indicator).toEqual({ kind: "card", rowKey: "A" });
    expect(resolveDrop(L1, at(L1, "A", 0.72), drag("C"))?.indicator).toEqual({ kind: "card", rowKey: "A" });
  });

  it("row 6: the middle of a subtask card → right after it, drawn as the line after it (CHK005)", () => {
    expect(resolveDrop(L1, at(L1, "S1", MIDDLE), drag("A"))).toEqual({
      dest: { kind: "sub", parentId: "P", beforeId: "S2" },
      indicator: { kind: "line", y: lineAfter(4), indent: "sub" },
    });
  });

  it("a subtask dragged from P lands under Q by rows 1, 2 and 5", () => {
    const L = layout([
      { key: "P", expanded: true },
      { key: "S1", parentId: "P" },
      { key: "Q", expanded: true },
      { key: "Q1", parentId: "Q" },
      { key: "new-task", kind: "new-task" },
    ]);
    const s1 = drag("S1", { parentId: "P" });
    expect(resolveDrop(L, at(L, "Q", LOWER), s1)?.dest).toEqual({ kind: "sub", parentId: "Q", beforeId: "Q1" });
    expect(resolveDrop(L, at(L, "Q1", LOWER), s1)?.dest).toEqual({ kind: "sub", parentId: "Q", beforeId: null });
    expect(resolveDrop(L, at(L, "Q", MIDDLE), s1)?.dest).toEqual({ kind: "sub", parentId: "Q", beforeId: null });
  });

  it("FR-009, FR-009a: a parent never lands on its own card or among its own subtasks", () => {
    const p = drag("P", { isParent: true });
    for (const [key, f] of [["P", MIDDLE], ["P", LOWER], ["S1", UPPER], ["S1", MIDDLE], ["S2", LOWER], ["S3", MIDDLE]] as const) {
      expect(resolveDrop(L1, at(L1, key, f), p)).toBeNull();
    }
  });

  it("FR-009a: a subtask dropped on its own parent's middle stays when it is already the last (also the only one)", () => {
    expect(resolveDrop(L1, at(L1, "P", MIDDLE), drag("S3", { parentId: "P" }))).toBeNull();
    const L = layout([{ key: "P", expanded: true }, { key: "S1", parentId: "P" }, { key: "new-task", kind: "new-task" }]);
    expect(resolveDrop(L, at(L, "P", MIDDLE), drag("S1", { parentId: "P" }))).toBeNull();
    expect(resolveDrop(L1, at(L1, "P", MIDDLE), drag("S1", { parentId: "P" }))?.dest).toEqual({ kind: "sub", parentId: "P", beforeId: null });
  });

  it("a parent dropped onto the middle of a subtask card in another parent becomes a subtask there (FR-008)", () => {
    const L = layout([{ key: "X", expanded: true }, { key: "X1", parentId: "X" }, { key: "P", expanded: true }, { key: "S1", parentId: "P" }, { key: "new-task", kind: "new-task" }]);
    expect(resolveDrop(L, at(L, "S1", MIDDLE), drag("X", { isParent: true }))?.dest).toEqual({ kind: "sub", parentId: "P", beforeId: null });
  });
});

// Stale group G1–G3 on top (G2 expanded with G2a), then manual M1, M2, then the empty card.
const LG = layout([
  { key: "G1", group: true },
  { key: "G2", group: true, expanded: true },
  { key: "G2a", parentId: "G2" },
  { key: "G3", group: true },
  { key: "M1" },
  { key: "M2" },
  { key: "new-task", kind: "new-task" },
]);
const justBelowGroup = lineAfter(3); // between G3 and M1

describe("US3: the stale group (FR-013, FR-009a; Clarifications 2026-10-17, PRD Q105)", () => {
  it("a non-stale item over the group's area lands just below the group", () => {
    for (const [key, f] of [["G1", UPPER], ["G2", UPPER], ["G3", UPPER], ["G1", LOWER], ["G2a", LOWER]] as const) {
      const r = resolveDrop(LG, at(LG, key, f), drag("M2"));
      if (key === "G2a") {
        // The upper part of the gap after G2's last subtask keeps row 2.
        expect(r?.dest).toEqual({ kind: "sub", parentId: "G2", beforeId: null });
        continue;
      }
      expect(r).toEqual({ dest: { kind: "top", beforeId: "M1" }, indicator: { kind: "line", y: justBelowGroup, indent: "top" } });
    }
  });

  it("a stale item over the group's area rejoins the group, with the whole group outlined", () => {
    for (const [key, f] of [["G1", UPPER], ["G2", UPPER], ["G3", UPPER], ["G1", LOWER]] as const) {
      expect(resolveDrop(LG, at(LG, key, f), drag("M2", { stale: true }))).toEqual({ dest: { kind: "group" }, indicator: { kind: "group" } });
    }
    expect(resolveDrop(LG, at(LG, "G1", UPPER), drag("S", { parentId: "M1", stale: true }))?.dest).toEqual({ kind: "group" });
  });

  it("just below the group (the lower part of G3, the upper part of M1) is the top of the manual order, also for a stale item", () => {
    for (const [key, f] of [["G3", LOWER], ["M1", UPPER]] as const) {
      expect(resolveDrop(LG, at(LG, key, f), drag("M2", { stale: true }))).toEqual({
        dest: { kind: "top", beforeId: "M1" },
        indicator: { kind: "line", y: justBelowGroup, indent: "top" },
      });
    }
  });

  it("an expanded group task's lower part is its first subtask (row 1); a collapsed one follows the group's area", () => {
    expect(resolveDrop(LG, at(LG, "G2", LOWER), drag("M2"))?.dest).toEqual({ kind: "sub", parentId: "G2", beforeId: "G2a" });
    expect(resolveDrop(LG, at(LG, "G1", LOWER), drag("M2", { stale: true }))?.dest).toEqual({ kind: "group" });
  });

  it("the middle of a group card makes a subtask of it, for every dragged kind", () => {
    for (const d of [drag("M2"), drag("M2", { stale: true }), drag("G3", { stale: true }), drag("M1", { isParent: true })]) {
      expect(resolveDrop(LG, at(LG, "G1", MIDDLE), d)).toEqual({ dest: { kind: "sub", parentId: "G1", beforeId: null }, indicator: { kind: "card", rowKey: "G1" } });
    }
  });

  it("a group task dragged within the group's area, or just below it when it is the last, does not move (FR-009a)", () => {
    const g1 = drag("G1", { stale: true });
    expect(resolveDrop(LG, at(LG, "G3", UPPER), g1)).toBeNull();
    expect(resolveDrop(LG, at(LG, "G1", UPPER), g1)).toBeNull();
    const g3 = drag("G3", { stale: true });
    expect(resolveDrop(LG, at(LG, "G3", LOWER), g3)).toBeNull();
    expect(resolveDrop(LG, at(LG, "M1", UPPER), g3)).toBeNull();
    // G1 below the group is a real move: it leaves the group, positioned by hand.
    expect(resolveDrop(LG, at(LG, "M1", UPPER), g1)?.dest).toEqual({ kind: "top", beforeId: "M1" });
  });

  it("with an empty group every top-level gap is offered, above the first task too", () => {
    expect(resolveDrop(L1, at(L1, "A", UPPER), drag("C", { stale: true }))?.dest).toEqual({ kind: "top", beforeId: "A" });
  });

  it("the same pointer gives the line for a non-stale item and the group for a stale one (an item going stale mid-drag, CHK019)", () => {
    const y = at(LG, "G2", UPPER);
    expect(resolveDrop(LG, y, drag("M2"))?.indicator).toEqual({ kind: "line", y: justBelowGroup, indent: "top" });
    expect(resolveDrop(LG, y, drag("M2", { stale: true }))?.indicator).toEqual({ kind: "group" });
  });

  it("a group with no manual task after it: just below the group is the end", () => {
    const L = layout([{ key: "G1", group: true }, { key: "G2", group: true }, { key: "new-task", kind: "new-task" }]);
    expect(resolveDrop(L, at(L, "G1", UPPER), drag("X", { parentId: "G1" }))).toEqual({
      dest: { kind: "top", beforeId: null },
      indicator: { kind: "line", y: lineAfter(1), indent: "top" },
    });
  });
});

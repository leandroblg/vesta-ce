/**
 * Where a drop lands (004 FR-006 to FR-013, FR-017; research §2): a pointer position over a snapshot of
 * the list as shown at drag start → the destination and the indicator to draw. Pure: no DOM import.
 */
import type { MoveDest } from "./move";

/** What the overlay draws before release (FR-012). */
export type Indicator =
  | { kind: "line"; y: number; indent: "top" | "sub" }
  | { kind: "card"; rowKey: string } // onto the middle of a top-level card
  | { kind: "group" }; // the whole stale group, when a stale item would rejoin it

/** One shown row, in content coordinates (relative to the scrolling element's content). */
export interface LayoutRow {
  /** The task or reminder id, or "new-task" / "new-rem" for an empty card. */
  key: string;
  kind: "task" | "sub" | "new-task" | "rem" | "new-rem";
  id: string | null;
  parentId: string | null;
  top: number;
  height: number;
  /** A top-level task whose subtasks are shown under it. */
  expandedParent: boolean;
  /** An auto-sorted stale task (pinned, 003). */
  inGroup: boolean;
  lastInGroup: boolean;
}

/** The dragged task: `stale` is read at each resolution, so the result follows a task going stale mid-drag. */
export interface DraggedItem {
  id: string;
  parentId: string | null;
  isParent: boolean;
  stale: boolean;
}

export interface DropResult {
  dest: MoveDest;
  indicator: Indicator;
}

type Zone = "upper" | "middle" | "lower";

/** Card zones (FR-007): the 28% and 72% boundaries belong to the middle part. */
const UPPER_END = 0.28;
const LOWER_START = 0.72;

/** The row under `y` and the zone in it; a pointer in a gap belongs to the nearer card (binary search). */
function locate(rows: readonly LayoutRow[], y: number, zoneOf: (rel: number) => Zone): { i: number; zone: Zone } {
  let lo = 0;
  let hi = rows.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid] as LayoutRow).top <= y) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (i < 0) return { i: 0, zone: "upper" };
  const row = rows[i] as LayoutRow;
  const bottom = row.top + row.height;
  if (y > bottom) {
    const next = rows[i + 1];
    if (next !== undefined && y >= (bottom + next.top) / 2) return { i: i + 1, zone: "upper" };
    return { i, zone: "lower" };
  }
  return { i, zone: zoneOf((y - row.top) / row.height) };
}

const cardZone = (rel: number): Zone => (rel < UPPER_END ? "upper" : rel <= LOWER_START ? "middle" : "lower");
const halfZone = (rel: number): Zone => (rel < 0.5 ? "upper" : "lower");

/** The y of the line in the gap above row i (or just above the first row). */
function lineBefore(rows: readonly LayoutRow[], i: number): number {
  const row = rows[i] as LayoutRow;
  const prev = rows[i - 1];
  return prev === undefined ? row.top - 4 : (prev.top + prev.height + row.top) / 2;
}

/** The y of the line in the gap below row i (or just below the last row). */
function lineAfter(rows: readonly LayoutRow[], i: number): number {
  if (i < rows.length - 1) return lineBefore(rows, i + 1);
  const row = rows[i] as LayoutRow;
  return row.top + row.height + 4;
}

/** The next top-level task row after index i (skipping subtasks), or null at the end. */
function nextTop(rows: readonly LayoutRow[], i: number): LayoutRow | null {
  for (let j = i + 1; j < rows.length; j++) {
    const r = rows[j] as LayoutRow;
    if (r.kind === "task") return r;
    if (r.kind === "new-task") return null;
  }
  return null;
}

/** The next subtask of the same parent after index i, or null when i is the last one. */
function nextSibling(rows: readonly LayoutRow[], i: number): LayoutRow | null {
  const r = rows[i + 1];
  return r !== undefined && r.kind === "sub" && r.parentId === (rows[i] as LayoutRow).parentId ? r : null;
}

const line = (y: number, indent: "top" | "sub"): Indicator => ({ kind: "line", y, indent });

/** The table row a zone of a row gives, before the no-move check (FR-006, FR-007). */
function rawTarget(rows: readonly LayoutRow[], i: number, zone: Zone): DropResult | null {
  const row = rows[i] as LayoutRow;
  if (row.kind === "new-task") return { dest: { kind: "top", beforeId: null }, indicator: line(lineBefore(rows, i), "top") };
  if (row.kind === "task" && row.id !== null) {
    if (zone === "upper") return { dest: { kind: "top", beforeId: row.id }, indicator: line(lineBefore(rows, i), "top") };
    // Row 5: onto the middle of a top-level card.
    if (zone === "middle") return { dest: { kind: "sub", parentId: row.id, beforeId: null }, indicator: { kind: "card", rowKey: row.key } };
    // Row 1: below an expanded parent's card is above its first subtask.
    if (row.expandedParent) {
      return { dest: { kind: "sub", parentId: row.id, beforeId: rows[i + 1]?.id ?? null }, indicator: line(lineAfter(rows, i), "sub") };
    }
    return { dest: { kind: "top", beforeId: nextTop(rows, i)?.id ?? null }, indicator: line(lineAfter(rows, i), "top") };
  }
  if (row.kind === "sub" && row.parentId !== null) {
    if (zone === "upper") return { dest: { kind: "sub", parentId: row.parentId, beforeId: row.id }, indicator: line(lineBefore(rows, i), "sub") };
    // Rows 2 and 6: the middle and lower parts of a subtask are right after it (the last subtask: row 2).
    return { dest: { kind: "sub", parentId: row.parentId, beforeId: nextSibling(rows, i)?.id ?? null }, indicator: line(lineAfter(rows, i), "sub") };
  }
  return null;
}

/** The first top-level task outside the stale group (the top of the manual order), as a row index or -1. */
function firstManual(rows: readonly LayoutRow[]): number {
  return rows.findIndex((r) => (r.kind === "task" && !r.inGroup) || r.kind === "new-task");
}

/**
 * The stale group is always on top (FR-013, PRD Q105): a top-level gap before a group task is the group's
 * area. A stale item dropped there rejoins the group; anything else lands just below the group.
 */
function applyGroup(rows: readonly LayoutRow[], raw: DropResult, dragged: DraggedItem): DropResult {
  if (raw.dest.kind !== "top" || raw.dest.beforeId === null) return raw;
  const before = raw.dest.beforeId;
  if (rows.find((r) => r.id === before)?.inGroup !== true) return raw;
  if (dragged.stale) return { dest: { kind: "group" }, indicator: { kind: "group" } };
  const j = firstManual(rows);
  const row = rows[j];
  const beforeId = row !== undefined && row.kind === "task" ? row.id : null;
  const y = j >= 0 ? lineBefore(rows, j) : lineAfter(rows, rows.length - 1);
  return { dest: { kind: "top", beforeId }, indicator: line(y, "top") };
}

/** The dragged item's current place, as the destination that would leave it there (FR-009a). */
function isOwnPlace(rows: readonly LayoutRow[], dest: MoveDest, dragged: DraggedItem): boolean {
  const i = rows.findIndex((r) => r.id === dragged.id);
  if (i < 0) return false;
  const row = rows[i] as LayoutRow;
  if (row.inGroup) {
    // A group task: the group's area, and just below the group when it is the last one.
    if (dest.kind === "group") return true;
    const j = firstManual(rows);
    const first = rows[j];
    const below = first !== undefined && first.kind === "task" ? first.id : null;
    return dest.kind === "top" && row.lastInGroup && dest.beforeId === below;
  }
  if (dragged.parentId === null) {
    return dest.kind === "top" && (dest.beforeId === dragged.id || dest.beforeId === (nextTop(rows, i)?.id ?? null));
  }
  return (
    dest.kind === "sub" &&
    dest.parentId === dragged.parentId &&
    (dest.beforeId === dragged.id || dest.beforeId === (nextSibling(rows, i)?.id ?? null))
  );
}

/** Where a task or subtask dropped at content y lands, and what to draw; null = no move (FR-003, FR-009a). */
export function resolveDrop(rows: readonly LayoutRow[], y: number, dragged: DraggedItem): DropResult | null {
  if (rows.length === 0) return null;
  const { i, zone } = locate(rows, y, cardZone);
  const found = rawTarget(rows, i, zone);
  if (found === null) return null;
  const raw = applyGroup(rows, found, dragged);
  if (isOwnPlace(rows, raw.dest, dragged)) return null;
  // One level only (FR-009): never under itself, and so never among its own subtasks.
  if (raw.dest.kind === "sub" && raw.dest.parentId === dragged.id) return null;
  return raw;
}

/** Where a reminder dropped at content y lands (FR-017): halves of a card; the empty or maximum card = the end. */
export function resolveReminderDrop(rows: readonly LayoutRow[], y: number, draggedId: string): { beforeId: string | null; indicator: Indicator } | null {
  if (rows.length === 0) return null;
  const { i, zone } = locate(rows, y, halfZone);
  const row = rows[i] as LayoutRow;
  const next = (j: number): string | null => {
    const r = rows[j + 1];
    return r !== undefined && r.kind === "rem" ? r.id : null;
  };
  let result: { beforeId: string | null; indicator: Indicator };
  if (row.kind !== "rem") result = { beforeId: null, indicator: line(lineBefore(rows, i), "top") };
  else if (zone === "upper") result = { beforeId: row.id, indicator: line(lineBefore(rows, i), "top") };
  else result = { beforeId: next(i), indicator: line(lineAfter(rows, i), "top") };
  const own = rows.findIndex((r) => r.id === draggedId);
  if (own >= 0 && (result.beforeId === draggedId || result.beforeId === next(own))) return null;
  return result;
}

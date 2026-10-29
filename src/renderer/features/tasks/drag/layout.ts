/**
 * The layout snapshot a drag resolves against (004 research §2, §5): the rows as shown at drag start,
 * read once. Coordinates are relative to `.main-inner`, which scrolls with the rows, so the snapshot stays
 * valid while the list scrolls and the overlay can be drawn in the same coordinates.
 */
import type { LayoutRow } from "../../../../domain/drop-rules";

const KINDS: Record<string, LayoutRow["kind"]> = {
  task: "task",
  "new-task": "new-task",
  rem: "rem",
  "new-rem": "new-rem",
  "rem-max": "new-rem",
};

export interface Snapshot {
  rows: LayoutRow[];
  /** The list's horizontal extent, for drawing lines and outlines. */
  left: number;
  width: number;
  /** Left margin of a subtask card (the sub indent). */
  subIndent: number;
}

export function snapshot(list: HTMLElement, origin: HTMLElement): Snapshot {
  const base = origin.getBoundingClientRect();
  const rows: LayoutRow[] = [];
  let subIndent = 0;
  for (const el of list.querySelectorAll<HTMLElement>(":scope > li[data-kind]")) {
    const raw = el.dataset["kind"] ?? "";
    const isSub = raw === "task" && el.classList.contains("sub");
    const kind = isSub ? "sub" : KINDS[raw];
    if (kind === undefined) continue;
    const rect = el.getBoundingClientRect();
    if (isSub && subIndent === 0) subIndent = rect.left - list.getBoundingClientRect().left;
    const id = el.dataset["id"] ?? null;
    rows.push({
      key: id ?? raw,
      kind,
      id,
      parentId: el.dataset["parent"] ?? null,
      top: rect.top - base.top,
      height: rect.height,
      expandedParent: el.dataset["expanded"] === "1",
      inGroup: el.dataset["group"] === "1",
      lastInGroup: false,
    });
  }
  const group = rows.filter((r) => r.inGroup);
  const last = group[group.length - 1];
  if (last !== undefined) last.lastInGroup = true;
  const listRect = list.getBoundingClientRect();
  return { rows, left: listRect.left - base.left, width: listRect.width, subIndent };
}

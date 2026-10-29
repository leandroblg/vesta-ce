/**
 * 016 FR-014, FR-014a, FR-017 (PRD Q233, Q234, Q251): the links a range touches, as whole runs. The link panel
 * prefills from them, edits a link in place, and Copy Link copies the address of the one link at the cursor.
 */
import type { MarkType, Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorState } from "@milkdown/kit/prose/state";
import { isSafeAddress } from "../../domain/markdown/links";

/** One link: its whole extent in the document, its address and its text. */
export interface LinkRun {
  from: number;
  to: number;
  href: string;
  text: string;
}

/** Every link run of `block` (a textblock at `start`): consecutive text with the same link mark is one run. */
function runsOf(block: ProseNode, start: number, type: MarkType): LinkRun[] {
  const runs: LinkRun[] = [];
  let pos = start + 1;
  block.forEach((child) => {
    const mark = child.isText ? type.isInSet(child.marks) : undefined;
    const end = pos + child.nodeSize;
    const last = runs.at(-1);
    if (mark !== undefined) {
      const href = String(mark.attrs["href"] ?? "");
      if (last !== undefined && last.to === pos && last.href === href) {
        last.to = end;
        last.text += child.text ?? "";
      } else runs.push({ from: pos, to: end, href, text: child.text ?? "" });
    }
    pos = end;
  });
  return runs;
}

/**
 * The link runs `[from, to]` touches, each whole. An empty range touches the run the cursor stands in, its ends
 * included (a cursor right after a link's last letter is still in it, as the editor's own marks say).
 */
export function linkRuns(state: EditorState, from: number, to: number): LinkRun[] {
  const type = state.schema.marks["link"];
  if (type === undefined) return [];
  const out: LinkRun[] = [];
  state.doc.nodesBetween(Math.max(0, from - 1), Math.min(state.doc.content.size, to + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    for (const run of runsOf(node, pos, type)) {
      const touches = from === to ? run.from <= from && from <= run.to : run.from < to && from < run.to;
      if (touches) out.push(run);
    }
    return false;
  });
  return out;
}

/** 016 FR-017: the one safe link the selection or cursor lies inside, or null (Copy Link, linkAtCursor). */
export function linkInside(state: EditorState): LinkRun | null {
  const { from, to } = state.selection;
  const runs = linkRuns(state, from, to);
  const run = runs[0];
  if (runs.length !== 1 || run === undefined) return null;
  if (from < run.from || to > run.to) return null;
  return isSafeAddress(run.href) ? run : null;
}

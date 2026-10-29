// Unedited blocks keep their stored spelling (FR-015b): the editor serializes the whole document,
// but every top-level block it did not change is written back as its original source.

export type EditorBlock = {
  /** The block's original source when the user did not edit it; null for an edited or new block. */
  source: string | null;
  /** The block in canonical markdown (FR-015a). */
  md: string;
};

const BLANK = /^\s*$/;
const SEPARATOR = "\n\n";

export function preserveUnedited(originalMd: string, blocks: EditorBlock[]): string {
  let out = "";
  let cursor = 0;
  // End offset in the original of the previous block, when it was unedited and found there.
  let previousEnd: number | null = null;

  for (const [index, block] of blocks.entries()) {
    let start: number | null = null;
    let end: number | null = null;
    if (block.source !== null) {
      const at = originalMd.indexOf(block.source, cursor);
      if (at >= 0) {
        start = at;
        end = at + block.source.length;
        cursor = end;
      }
    }
    if (index === 0) {
      const lead = start === null ? "" : originalMd.slice(0, start);
      if (BLANK.test(lead)) out += lead;
    } else {
      const gap = previousEnd !== null && start !== null ? originalMd.slice(previousEnd, start) : null;
      out += gap !== null && gap !== "" && BLANK.test(gap) ? gap : SEPARATOR;
    }
    out += block.source ?? block.md;
    previousEnd = end;
  }

  if (previousEnd !== null) {
    const tail = originalMd.slice(previousEnd);
    if (BLANK.test(tail)) out += tail;
  }
  return out;
}

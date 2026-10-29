// The one-line details excerpt shown when a task matches through its details (006 FR-013).
import { foldText } from "./fold";
import { normalizedText, termKeys } from "./match";
import type { Query, SearchOptions } from "./query";

const MAX = 120;
const ELLIPSIS = "…";

/**
 * At most 120 characters of `bodyPlain` around the first occurrence of the phrase (Exact phrase on) or of
 * the first search word, in typed order, that the title lacks; cut at word boundaries, with "…" where text
 * is left out. Null when there is nothing to show.
 */
export function excerpt(bodyPlain: string, titlePlain: string, query: Query, opts: SearchOptions): string | null {
  const keys = termKeys(query, opts);
  if (keys.length === 0 || bodyPlain === "") return null;
  const title = foldText(titlePlain, opts.matchCase);
  const target = opts.exactPhrase ? (title.includes(keys[0] ?? "") ? undefined : keys[0]) : keys.find((k) => !title.includes(k));
  if (target === undefined) return null;
  const body = normalizedText(bodyPlain, opts.matchCase);
  const at = body.s.indexOf(target);
  if (at < 0) return null;
  if (bodyPlain.length <= MAX) return bodyPlain;

  const ms = body.starts[at] ?? 0;
  const me = body.ends[at + target.length - 1] ?? ms;
  const room = MAX - 2 * ELLIPSIS.length;
  let start: number;
  let end: number;
  if (me - ms >= room) {
    start = ms;
    end = ms + room;
  } else {
    start = Math.max(0, ms - Math.floor((room - (me - ms)) / 2));
    end = Math.min(bodyPlain.length, start + room);
    start = Math.max(0, end - room);
  }
  // Whole words only, never cutting into the match itself.
  if (start > 0 && bodyPlain.charAt(start - 1) !== " ") {
    const next = bodyPlain.indexOf(" ", start);
    if (next >= 0 && next + 1 <= ms) start = next + 1;
  }
  if (end < bodyPlain.length && bodyPlain.charAt(end) !== " ") {
    const prev = bodyPlain.lastIndexOf(" ", end - 1);
    if (prev >= me) end = prev;
  }
  const text = bodyPlain.slice(start, end).trim();
  return (start > 0 ? ELLIPSIS : "") + text + (end < bodyPlain.length ? ELLIPSIS : "");
}

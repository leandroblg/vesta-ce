// The exact matching rules (006 FR-004 to FR-004d) and highlight ranges (FR-012). The FTS5 index only
// narrows candidates; these functions decide (research §1).
import { fold, foldText } from "./fold";
import type { Query, SearchOptions } from "./query";

interface Normalized {
  s: string;
  starts: number[];
  ends: number[];
}

/** Folds the text and collapses whitespace runs to one space, keeping offsets into the original. */
function normalize(text: string, matchCase: boolean): Normalized {
  const { folded, map, ends } = fold(text, { matchCase });
  // Fast path: searchable text is already collapsed (one plain space between words), so nothing to rebuild.
  if (!/[^\S ]| {2}/.test(folded)) return { s: folded, starts: map, ends };
  let s = "";
  const outStarts: number[] = [];
  const outEnds: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    const ch = folded.charAt(i);
    if (/\s/.test(ch)) {
      if (s.endsWith(" ")) {
        outEnds[outEnds.length - 1] = ends[i] ?? 0;
        continue;
      }
      s += " ";
    } else {
      s += ch;
    }
    outStarts.push(map[i] ?? 0);
    outEnds.push(ends[i] ?? 0);
  }
  return { s, starts: outStarts, ends: outEnds };
}

/** Folds and collapses whitespace, without offset maps (matching does not need them). */
function normalizeText(text: string, matchCase: boolean): string {
  const f = foldText(text, matchCase);
  return /[^\S ]| {2}/.test(f) ? f.replace(/\s+/g, " ") : f;
}

const key = (term: string, matchCase: boolean): string => normalizeText(term, matchCase).trim();

export interface DocText {
  titlePlain: string;
  bodyPlain: string;
  /** The stored case- and accent-insensitive keys (search_docs), used instead of folding when Match case is off. */
  titleKey?: string;
  bodyKey?: string;
}

export interface DocMatch {
  matched: boolean;
  /** The title alone satisfies the query (FR-013: otherwise the card shows a details excerpt). */
  inTitle: boolean;
}

export function matchDoc(query: Query, doc: DocText, opts: SearchOptions): DocMatch {
  const terms = query.terms.map((t) => key(t, opts.matchCase)).filter((t) => t !== "");
  if (terms.length === 0) return { matched: false, inTitle: false };
  const useKeys = !opts.matchCase && doc.titleKey !== undefined && doc.bodyKey !== undefined;
  const title = useKeys ? (doc.titleKey ?? "") : normalizeText(doc.titlePlain, opts.matchCase);
  const body = useKeys ? (doc.bodyKey ?? "") : normalizeText(doc.bodyPlain, opts.matchCase);
  // Exact phrase is a single term, so "within one field" falls out of checking each field on its own.
  const inTitle = terms.every((t) => title.includes(t));
  const matched = inTitle || terms.every((t) => title.includes(t) || body.includes(t));
  return { matched, inTitle };
}

/** Every occurrence of each term in `text`, as [start, end) offsets into `text`, sorted and merged. */
export function findRanges(text: string, query: Query, opts: SearchOptions): Array<[number, number]> {
  const terms = query.terms.map((t) => key(t, opts.matchCase)).filter((t) => t !== "");
  if (terms.length === 0 || text === "") return [];
  const n = normalize(text, opts.matchCase);
  const found: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = n.s.indexOf(term, from);
      if (at < 0) break;
      const last = at + term.length - 1;
      found.push([n.starts[at] ?? 0, n.ends[last] ?? 0]);
      from = at + term.length;
    }
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const r of found) {
    const prev = merged[merged.length - 1];
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Which terms (folded keys) the text contains; used for the excerpt (FR-013). */
export function termKeys(query: Query, opts: SearchOptions): string[] {
  return query.terms.map((t) => key(t, opts.matchCase)).filter((t) => t !== "");
}

export function normalizedText(text: string, matchCase: boolean): Normalized {
  return normalize(text, matchCase);
}

// Folding for search (006 FR-004, FR-004b, FR-004e; research §3): accent marks removed after canonical
// decomposition, lowercased unless matchCase, the same in every locale. Letters with no decomposition
// (ø, æ, œ, ß, ł) stay as they are.

export interface Folded {
  folded: string;
  /** map[i]: the original index where folded UTF-16 unit i's character starts. */
  map: number[];
  /** ends[i]: the original index just after that character, including marks removed after it. */
  ends: number[];
}

const MARK = /\p{M}/gu;

const ASCII = /^\p{ASCII}*$/u;

export function fold(text: string, { matchCase }: { matchCase: boolean }): Folded {
  if (ASCII.test(text)) {
    // Fast path: no marks to remove, and ASCII lowercasing is one-to-one.
    const map = Array.from({ length: text.length }, (_, k) => k);
    return { folded: matchCase ? text : text.toLowerCase(), map, ends: map.map((k) => k + 1) };
  }
  let folded = "";
  const map: number[] = [];
  const ends: number[] = [];
  let i = 0;
  for (const ch of text) {
    const end = i + ch.length;
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      // ASCII inside mixed text: no marks, one-to-one case.
      folded += matchCase || code < 0x41 || code > 0x5a ? ch : String.fromCharCode(code + 32);
      map.push(i);
      ends.push(end);
      i = end;
      continue;
    }
    let part = ch.normalize("NFD");
    if (!matchCase) part = part.toLowerCase();
    part = part.replace(MARK, "");
    if (part === "") {
      // A mark of its own (decomposed input): it belongs to the character before it.
      if (ends.length > 0) {
        const last = ends.length - 1;
        for (let k = last; k >= 0 && ends[k] === ends[last]; k--) ends[k] = end;
      }
    } else {
      folded += part;
      for (let k = 0; k < part.length; k++) {
        map.push(i);
        ends.push(end);
      }
    }
    i = end;
  }
  return { folded, map, ends };
}

/** The folded string only, without offset maps: what matching needs (research §3). */
export function foldText(text: string, matchCase: boolean): string {
  if (ASCII.test(text)) return matchCase ? text : text.toLowerCase();
  return fold(text, { matchCase }).folded;
}

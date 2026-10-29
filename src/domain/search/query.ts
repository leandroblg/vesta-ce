// The search box's text as terms (006 FR-002, FR-004, FR-004a, FR-004d).

export interface SearchOptions {
  matchCase: boolean;
  exactPhrase: boolean;
}

export interface Query {
  /** Words as typed (not folded), or one phrase with whitespace collapsed. Empty: no search. */
  terms: string[];
}

export function parseQuery(text: string, { exactPhrase }: Pick<SearchOptions, "exactPhrase">): Query {
  const words = text.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return { terms: [] };
  return { terms: exactPhrase ? [words.join(" ")] : words };
}

export const isActive = (text: string): boolean => text.trim() !== "";

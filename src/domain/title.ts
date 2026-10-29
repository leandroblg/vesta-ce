const LINE_BREAK = /[^\S\r\n]*(?:\r\n|\r|\n|<br\s*\/?>)\s*/gi;

/**
 * Normalizes a typed title (FR-019): line breaks become single spaces, surrounding whitespace is
 * trimmed, markdown is kept as typed. Returns null when nothing is left, so an empty title is never saved.
 */
export function normalizeTitle(raw: string): string | null {
  const title = raw.replace(LINE_BREAK, " ").trim();
  return title === "" ? null : title;
}

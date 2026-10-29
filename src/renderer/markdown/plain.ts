// plainText for accessible names, the drag ghost and announcements, cached, with a fast path for plain titles.
import { plainText } from "../../domain/markdown/plain-text";

const MARKUP = /[*_`[\]{}=~<>!:#\\@|&]|https?:|www\./i;
const CACHE_SIZE = 2000;
const cache = new Map<string, string>();

export function plain(md: string): string {
  if (!MARKUP.test(md)) return md;
  const hit = cache.get(md);
  if (hit !== undefined) return hit;
  const text = plainText(md);
  cache.set(md, text);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return text;
}

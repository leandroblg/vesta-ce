/**
 * The search highlight (006 FR-012, research §7): CSS Custom Highlight API ranges over the text of every
 * element marked `data-hl` (card titles, reminders, excerpts, the Archive and Trash rows). No DOM change,
 * so React's tree and the cached markdown renderings are untouched.
 */
import { findRanges } from "../../../domain/search/match";
import { parseQuery } from "../../../domain/search/query";
import { useVesta } from "../../store/store";

export const HIGHLIGHT_NAME = "vesta-search";

function textNodes(el: Element): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Ranges for one element: matches are found in its joined text, so a match may span formatting runs. */
function rangesIn(el: Element, find: (text: string) => Array<[number, number]>): Range[] {
  const nodes = textNodes(el);
  if (nodes.length === 0) return [];
  const starts: number[] = [];
  let text = "";
  for (const n of nodes) {
    starts.push(text.length);
    text += n.data;
  }
  const locate = (offset: number, isEnd: boolean): [Text, number] => {
    let i = nodes.length - 1;
    while (i > 0 && ((starts[i] ?? 0) > offset || (isEnd && (starts[i] ?? 0) === offset))) i -= 1;
    const node = nodes[i] as Text;
    return [node, offset - (starts[i] ?? 0)];
  };
  return find(text).map(([a, b]) => {
    const range = new Range();
    const [sn, so] = locate(a, false);
    const [en, eo] = locate(b, true);
    range.setStart(sn, so);
    range.setEnd(en, eo);
    return range;
  });
}

export function applyHighlights(): void {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
  const { search } = useVesta.getState();
  if (!search.active) {
    CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }
  const opts = { matchCase: search.matchCase, exactPhrase: search.exactPhrase };
  const query = parseQuery(search.text, opts);
  const find = (text: string) => findRanges(text, query, opts);
  // Only what is on screen, or within one screen of it (006 SC-001); scrolling recomputes.
  const margin = window.innerHeight;
  const near = [...document.querySelectorAll("[data-hl]")].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom >= -margin && r.top <= window.innerHeight + margin;
  });
  const ranges = near.flatMap((el) => rangesIn(el, find));
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}

let frame: number | null = null;
/** Recomputes on the next frame, once, however many changes asked for it. */
export function scheduleHighlights(): void {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    applyHighlights();
  });
}

/** Keeps the highlight in step with the search and with what the main view renders. */
export function startSearchHighlights(root: Element): () => void {
  const unsubscribe = useVesta.subscribe((s, prev) => {
    if (s.search !== prev.search || s.tasks !== prev.tasks || s.reminders !== prev.reminders || s.view !== prev.view) scheduleHighlights();
  });
  const observer = new MutationObserver(scheduleHighlights);
  observer.observe(root, { subtree: true, childList: true, characterData: true });
  const onScroll = () => {
    if (useVesta.getState().search.active) scheduleHighlights();
  };
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onScroll);
  return () => {
    unsubscribe();
    observer.disconnect();
    root.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onScroll);
  };
}

// The searchable text of stored markdown (006 FR-003, FR-004d; research §2): what a reader sees, plus image
// text alternatives, with formatting removed. Block boundaries become spaces so no word spans two blocks.
// plainText (005) stays as it is for accessible names; this one follows the search rules.
import type { Nodes, Root } from "mdast";
import { parseMarkdown } from "../markdown/parse";
import { youtubeEmbedId } from "../markdown/policy";
import { flattenToTitleScope } from "../markdown/title-scope";

export type SearchScope = "title" | "details";

export interface SearchableTextOptions {
  /** The parser; replaceable so tests can make it fail. */
  parse?: (md: string) => Root;
  /** Called when parsing fails; the caller logs it (domain modules do no I/O). */
  onError?: (error: unknown) => void;
}

// Parents whose children are inline content, so their texts join without a space.
const INLINE_PARENTS = new Set<string>([
  ...["paragraph", "heading", "tableCell", "emphasis", "strong", "delete"],
  ...["link", "linkReference", "vestaSpan", "mark"],
]);

// Tags that break a line when rendered: a space, even inside a paragraph.
const BREAKING_TAG = /<\/?(?:br|p|div|li|ul|ol|tr|td|th|table|details|summary|hr|h[1-6]|blockquote|pre)\b[^>]*>/gi;
const TAG = /<[^>]*>/g;
const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) return safeCodePoint(parseInt(ref.slice(2), 16), whole);
    if (ref.startsWith("#")) return safeCodePoint(parseInt(ref.slice(1), 10), whole);
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}

function safeCodePoint(cp: number, fallback: string): string {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : fallback;
}

function htmlText(value: string, inline: boolean): string {
  const spaced = value.replace(BREAKING_TAG, " ");
  return decodeEntities(spaced.replace(TAG, inline ? "" : " "));
}

/** A paragraph that is only a YouTube address becomes an embed (005 FR-034): it shows no text. */
function isYoutubeLine(node: Nodes): boolean {
  if (node.type !== "paragraph" || node.children.length !== 1) return false;
  const only = node.children[0];
  if (only?.type === "link") return youtubeEmbedId(only.url) !== null;
  if (only?.type === "text") return youtubeEmbedId(only.value.trim()) !== null;
  return false;
}

function textOf(node: Nodes, inline: boolean): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
      return node.value;
    case "html":
      return htmlText(node.value, inline);
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "break":
      return " ";
    case "footnoteReference":
    case "definition":
      return "";
    default: {
      if (!("children" in node)) return "";
      if (isYoutubeLine(node)) return "";
      const childInline = INLINE_PARENTS.has(node.type);
      return (node.children as Nodes[]).map((child) => textOf(child, childInline)).join(childInline ? "" : " ");
    }
  }
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Never throws: on a parse error it returns the markdown with whitespace collapsed (research §2). */
export function searchableText(md: string, scope: SearchScope, options: SearchableTextOptions = {}): string {
  if (md.trim() === "") return "";
  const parse = options.parse ?? parseMarkdown;
  try {
    const tree = parse(md);
    if (scope === "title") flattenToTitleScope(tree, md);
    return collapse(textOf(tree, false));
  } catch (error) {
    options.onError?.(error);
    return collapse(md);
  }
}

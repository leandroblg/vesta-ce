// The text content of stored markdown, without markup: accessible names, drag ghosts, announcements, search (006).
import type { Nodes } from "mdast";
import { parseMarkdown } from "./parse";

// Parents whose children are inline content, so their texts join without a space.
const INLINE_PARENTS = new Set<string>([
  ...["paragraph", "heading", "tableCell", "emphasis", "strong", "delete"],
  ...["link", "linkReference", "vestaSpan", "mark"],
]);
const TAG = /<[^>]*>/g;

function textOf(node: Nodes): string {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
      return node.value;
    case "html":
      return node.value.replace(TAG, " ");
    case "image":
    case "imageReference":
      return node.alt ?? "";
    case "break":
      return " ";
    default:
      if (!("children" in node)) return "";
      return node.children.map(textOf).join(INLINE_PARENTS.has(node.type) ? "" : " ");
  }
}

export function plainText(md: string): string {
  if (md.trim() === "") return "";
  return textOf(parseMarkdown(md)).replace(/\s+/g, " ").trim();
}

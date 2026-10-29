// Titles and reminders (FR-014's first column): one paragraph or heading, inline formatting only.
// Anything else is shown as its source text, so nothing is lost (FR-015b). Shared by the editor and the renderer.
import type { Nodes, PhrasingContent, Root } from "mdast";
import { isAssetRef } from "./assets";

const TITLE_INLINE = new Set(["text", "emphasis", "strong", "inlineCode", "link", "delete", "vestaSpan", "mark"]);

function sourceOf(node: Nodes, md: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? "" : md.slice(start, end);
}

function flattenInline(children: PhrasingContent[], md: string): PhrasingContent[] {
  return children.map((child): PhrasingContent => {
    if (child.type === "image") {
      return isAssetRef(child.url) ? child : { type: "text", value: sourceOf(child, md) };
    }
    if (!TITLE_INLINE.has(child.type)) return { type: "text", value: sourceOf(child, md) };
    if ("children" in child) child.children = flattenInline(child.children, md);
    return child;
  });
}

/** Reshapes a parsed title in place; `md` is the text it was parsed from. */
export function flattenToTitleScope(tree: Root, md: string): void {
  const first = tree.children[0];
  if (tree.children.length === 1 && first && (first.type === "paragraph" || first.type === "heading")) {
    first.children = flattenInline(first.children, md);
    return;
  }
  const value = md.trim();
  tree.children =
    value === "" ? [] : [{ type: "paragraph", children: [{ type: "text", value }], position: tree.position }];
}

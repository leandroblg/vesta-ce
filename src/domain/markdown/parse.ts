// One shared parser for stored markdown: CommonMark, GFM and Vesta's spans (FR-014, FR-015).
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes, Root } from "mdast";
import { spans } from "./spans";

const parser = unified().use(remarkParse).use(remarkGfm).use(spans);

export function parseMarkdown(md: string): Root {
  return parser.parse(md);
}

/** Visits every node depth-first, in document order. */
export function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}

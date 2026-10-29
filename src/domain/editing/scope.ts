/**
 * What the floating menu's label names (012 FR-002 to FR-004, PRD Q149, Q160): with nothing selected in the
 * details, the kind of the block holding the cursor; "All details" only for a selection covering all of it.
 * The editor passes the cursor's ancestor node names, innermost first; nothing here knows about a document.
 */

export type ScopeKind = "paragraph" | "heading" | "listItem" | "quote" | "code" | "cell";
export type MenuLabel = "all" | "selection" | "whole" | ScopeKind;
export type LabelScope = "title" | "reminder" | "details";

const CONTAINER: Readonly<Record<string, ScopeKind>> = {
  list_item: "listItem",
  blockquote: "quote",
  table_cell: "cell",
  table_header: "cell",
};

/** A code block names itself; otherwise the nearest list item, quote or table cell; otherwise heading or paragraph. */
export function scopeKind(path: readonly string[]): ScopeKind {
  const [inner, ...outer] = path;
  if (inner === "code_block") return "code";
  for (const name of outer) {
    const kind = CONTAINER[name];
    if (kind !== undefined) return kind;
  }
  return inner === "heading" ? "heading" : "paragraph";
}

export interface LabelInput {
  /** Nothing is selected. */
  empty: boolean;
  /** The selection runs from the first to the last text position of the field. */
  coversAll: boolean;
  /** The cursor's ancestor node names, innermost first. */
  path: readonly string[];
}

export function menuLabel(input: LabelInput, scope: LabelScope): MenuLabel {
  if (scope !== "details") return input.empty ? "whole" : "selection";
  if (input.empty) return scopeKind(input.path);
  return input.coversAll ? "all" : "selection";
}

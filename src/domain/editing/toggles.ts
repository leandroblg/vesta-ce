/**
 * The decisions behind the floating menu's toggles (011 FR-001 to FR-007, data-model "Outcome table of the
 * toggles"): whether a button adds, removes or switches, and whether it shows as pressed. The editor describes
 * the range as plain data and builds the transaction; nothing here knows about a document.
 */

/** One innermost textblock of the range (FR-002). */
export interface BlockInfo {
  kind: "paragraph" | "heading" | "code";
  /** The kind of the nearest enclosing list, or null. */
  list: "bullet" | "ordered" | null;
  /** Identifies that nearest list (blocks of one list share it), or null. */
  listIndex: number | null;
  /** How many quotes enclose the block. */
  quoteDepth: number;
  /** 012: the nearest list item's checkbox (true or false), or null with none or outside a list. */
  checked?: boolean | null;
  /** 012: how many list items enclose the block (1 for a top-level item, 0 outside a list). */
  depth?: number;
  /** 012: the nearest list item has an item before it in its list. */
  hasPrevSibling?: boolean;
  /** 012: the block is inside a table cell. */
  inCell?: boolean;
}

/** One text node of the range: its highlight, if any (FR-001). */
export interface CharInfo {
  highlight: "none" | "default" | "color";
}

export interface RangeInfo {
  blocks: BlockInfo[];
  chars: CharInfo[];
}

export type ToggleCommand = "bullet" | "ordered" | "quote" | "codeblock";

export type BlockAction = { kind: "remove" } | { kind: "apply"; targets: number[] } | { kind: "switch"; targets: number[] };

const indexes = (blocks: readonly BlockInfo[], keep: (b: BlockInfo) => boolean): number[] =>
  blocks.flatMap((b, i) => (keep(b) ? [i] : []));

export function highlightAction(chars: readonly CharInfo[]): "remove" | "add" | "disabled" {
  if (chars.length === 0) return "disabled";
  return chars.every((c) => c.highlight !== "none") ? "remove" : "add";
}

function has(command: ToggleCommand, b: BlockInfo): boolean {
  switch (command) {
    case "codeblock":
      return b.kind === "code";
    case "bullet":
      return b.list === "bullet";
    case "ordered":
      return b.list === "ordered";
    case "quote":
      return b.quoteDepth >= 1;
  }
}

export function blockAction(command: ToggleCommand, blocks: readonly BlockInfo[]): BlockAction {
  if (blocks.length > 0 && blocks.every((b) => has(command, b))) return { kind: "remove" };
  if (command === "bullet" || command === "ordered") {
    const other = command === "bullet" ? "ordered" : "bullet";
    if (blocks.length > 0 && blocks.every((b) => b.list === other)) return { kind: "switch", targets: indexes(blocks, () => true) };
  }
  return { kind: "apply", targets: indexes(blocks, (b) => !has(command, b)) };
}

export function quoteAction(blocks: readonly BlockInfo[]): "unquote-one" | "quote-unquoted" {
  return blocks.length > 0 && blocks.every((b) => b.quoteDepth >= 1) ? "unquote-one" : "quote-unquoted";
}

/** 012 FR-010: paragraphs and list items take a checkbox; headings, code and table cells do not. */
const checkable = (b: BlockInfo): boolean => b.kind === "paragraph" && b.inCell !== true;
const isChecklistItem = (b: BlockInfo): boolean => b.list !== null && b.checked !== null && b.checked !== undefined;

/** 012 FR-010 to FR-012: remove when every checkable block has a checkbox, add otherwise, disabled with none. */
export function checklistAction(blocks: readonly BlockInfo[]): "add" | "remove" | "disabled" {
  const targets = blocks.filter(checkable);
  if (targets.length === 0) return "disabled";
  return targets.every(isChecklistItem) ? "remove" : "add";
}

/** 012 FR-006 to FR-008: Indent (1) needs an item with an item before it; outdent (-1) a nested item. */
export function indentAction(blocks: readonly BlockInfo[], dir: 1 | -1): "apply" | "disabled" {
  const items = blocks.filter((b) => b.list !== null && b.inCell !== true);
  const can = dir === 1 ? items.some((b) => b.hasPrevSibling === true) : items.some((b) => (b.depth ?? 1) > 1);
  return can ? "apply" : "disabled";
}

/** FR-006: pressed exactly when the whole range already has the button's effect. */
export function pressed(command: ToggleCommand | "highlight" | "check", info: RangeInfo): boolean {
  if (command === "highlight") return highlightAction(info.chars) === "remove";
  if (command === "check") return info.blocks.length > 0 && info.blocks.every(isChecklistItem);
  return info.blocks.length > 0 && info.blocks.every((b) => has(command, b));
}

/** FR-002a: the selected blocks, extended by the code block directly above and below when there is one. */
export function mergeSpan(
  count: number,
  before: boolean,
  after: boolean,
): { first: number; last: number; withBefore: boolean; withAfter: boolean } {
  return { first: 0, last: Math.max(0, count - 1), withBefore: before, withAfter: after };
}

/** 016 FR-023, FR-024 (PRD Q225, Q240, Q253): what typing `[] `, `[ ] `, `[x] ` or `[X] ` at a block's start does. */
export interface ShortcutContext {
  scope: "title" | "reminder" | "details";
  block: BlockInfo;
  /** The block is the first paragraph of its list item. */
  firstInItem: boolean;
}

/**
 * `wrap`: the paragraph becomes a one-item checklist (also inside a quote); `set`: the list item's checkbox takes the
 * typed state; `none`: the characters stay as typed (headings, code, table cells, titles, reminders).
 */
export function checklistShortcut(ctx: ShortcutContext): "wrap" | "set" | "none" {
  if (ctx.scope !== "details" || ctx.block.kind !== "paragraph" || ctx.block.inCell === true) return "none";
  if (ctx.block.list !== null) return ctx.firstInItem ? "set" : "none";
  return "wrap";
}

/** 016 FR-025 (PRD Q231): one list the range turns the checkboxes off in. */
export interface ListContext {
  /** The range covers every item of the list. */
  coversAll: boolean;
  /** The list is inside a list item. */
  nestedInItem: boolean;
  /** The sibling block directly above or below the list, in the same parent, is a bulleted or numbered list. */
  prevIsList: boolean;
  nextIsList: boolean;
}

/** `lift`: the items become paragraphs and their list goes; `keep`: they stay in their list as plain items. */
export function checklistOff(list: ListContext): "lift" | "keep" {
  return list.coversAll && !list.nestedInItem && !list.prevIsList && !list.nextIsList ? "lift" : "keep";
}

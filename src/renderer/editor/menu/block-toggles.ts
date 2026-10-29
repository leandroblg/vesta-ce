// The floating menu's toggles as single transactions (011 US1, research §1 to §7). The decisions come from
// src/domain/editing/toggles.ts; this module reads the range from the ProseMirror state and builds one
// transaction per action, so each is one Undo step (FR-007).
import { Fragment, type Mark as ProseMark, type Node as ProseNode, type NodeType } from "@milkdown/kit/prose/model";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import { closeHistory } from "@milkdown/kit/prose/history";
import { TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { canJoin, findWrapping, liftTarget } from "@milkdown/kit/prose/transform";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  blockAction,
  checklistAction,
  checklistOff,
  checklistShortcut,
  highlightAction,
  indentAction,
  pressed,
  quoteAction,
  type BlockInfo,
  type CharInfo,
  type RangeInfo,
  type ToggleCommand,
} from "../../../domain/editing/toggles";
import { canStep, stepSize } from "../../../domain/editing/font-size";
import { emptyAttributes, type SpanAttributes } from "../../../domain/markdown/spans";

interface Textblock {
  node: ProseNode;
  pos: number;
  info: BlockInfo;
}

const LISTS = new Set(["bullet_list", "ordered_list"]);

/** Which field the menu edits; titles and reminders keep their whole scope (012 FR-003). */
export type RangeScope = "title" | "reminder" | "details";

/**
 * The range every menu option acts on (012 FR-001, research §1): the selection; with none, the whole field in a
 * title or reminder, and the text of the textblock holding the cursor in the details (empty in an empty paragraph).
 */
export function menuRange(state: EditorState, scope: RangeScope): { from: number; to: number } {
  const sel = state.selection;
  if (!sel.empty) return { from: sel.from, to: sel.to };
  if (scope !== "details") return { from: 0, to: state.doc.content.size };
  const $from = sel.$from;
  return $from.parent.isTextblock ? { from: $from.start(), to: $from.end() } : { from: sel.from, to: sel.to };
}

/** Block formats act on the selection or, with none, the block holding the cursor (FR-007). */
export function blockRangeOf(state: EditorState): { from: number; to: number } {
  const sel = state.selection;
  if (!sel.empty) return { from: sel.from, to: sel.to };
  const $from = sel.$from;
  return $from.parent.isTextblock ? { from: $from.start(), to: $from.end() } : { from: sel.from, to: sel.to };
}

function infoAt(doc: ProseNode, pos: number, node: ProseNode): BlockInfo {
  const $p = doc.resolve(pos + 1);
  let list: BlockInfo["list"] = null;
  let listIndex: number | null = null;
  let quoteDepth = 0;
  // 012: the nearest list item's checkbox and place, the list nesting, and whether a table cell holds the block.
  let checked: boolean | null = null;
  let item = false;
  let hasPrevSibling = false;
  let depth = 0;
  let inCell = false;
  for (let d = $p.depth - 1; d >= 1; d--) {
    const n = $p.node(d);
    const name = n.type.name;
    if (list === null && LISTS.has(name)) {
      list = name === "bullet_list" ? "bullet" : "ordered";
      listIndex = $p.before(d);
    }
    if (name === "list_item") {
      depth++;
      if (!item) {
        item = true;
        const c = n.attrs["checked"] as boolean | null | undefined;
        checked = c === true || c === false ? c : null;
        hasPrevSibling = $p.index(d - 1) > 0;
      }
    }
    if (name === "blockquote") quoteDepth++;
    if (name === "table_cell" || name === "table_header") inCell = true;
  }
  const kind = node.type.name === "code_block" ? "code" : node.type.name === "heading" ? "heading" : "paragraph";
  return { kind, list, listIndex, quoteDepth, checked, depth, hasPrevSibling, inCell };
}

function textblocks(doc: ProseNode, from: number, to: number): Textblock[] {
  const out: Textblock[] = [];
  doc.nodesBetween(from, Math.max(to, from + 1), (node, pos) => {
    if (!node.isTextblock) return true;
    out.push({ node, pos, info: infoAt(doc, pos, node) });
    return false;
  });
  return out;
}

function chars(state: EditorState, from: number, to: number): CharInfo[] {
  const mark = state.schema.marks["mark"];
  const span = state.schema.marks["vestaSpan"];
  const out: CharInfo[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    const s = span?.isInSet(node.marks);
    const colored = s !== undefined && (s.attrs as SpanAttributes).bg !== null;
    out.push({ highlight: colored ? "color" : mark?.isInSet(node.marks) ? "default" : "none" });
    return false;
  });
  return out;
}

/** The range as plain data, for the pressed states and the decisions (FR-006). */
export function describeRange(state: EditorState, scope: RangeScope = "details"): RangeInfo {
  const b = blockRangeOf(state);
  const m = menuRange(state, scope);
  return { blocks: textblocks(state.doc, b.from, b.to).map((t) => t.info), chars: chars(state, m.from, m.to) };
}

export function pressedStates(state: EditorState, scope: RangeScope = "details"): Record<ToggleCommand | "highlight" | "check", boolean> {
  const info = describeRange(state, scope);
  return {
    check: pressed("check", info),
    highlight: pressed("highlight", info),
    bullet: pressed("bullet", info),
    ordered: pressed("ordered", info),
    quote: pressed("quote", info),
    codeblock: pressed("codeblock", info),
  };
}

// ---------------------------------------------------------------------------
// Highlight (FR-001)

export function setSpanIn(tr: Transaction, from: number, to: number, key: keyof SpanAttributes, value: string | null): void {
  const type = tr.doc.type.schema.marks["vestaSpan"];
  if (!type) return;
  // Every text node of the range: one span each, keeping its other attributes (one span, 005 FR-015).
  const spans: { s: number; e: number; attrs: SpanAttributes }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const old = type.isInSet(node.marks);
    spans.push({ s: Math.max(from, pos), e: Math.min(to, pos + node.nodeSize), attrs: (old?.attrs as SpanAttributes | undefined) ?? emptyAttributes() });
    return false;
  });
  for (const { s, e, attrs } of spans) {
    const next: SpanAttributes = { ...emptyAttributes(), ...attrs, [key]: value };
    tr.removeMark(s, e, type);
    if (next.color !== null || next.bg !== null || next.size !== null || next.underline || next.other.length > 0) tr.addMark(s, e, type.create(next));
  }
}

/** The marks the next typed text will carry at the cursor (an empty paragraph, Edge Cases). */
function nextMarks(state: EditorState): readonly ProseMark[] {
  return state.storedMarks ?? state.selection.$from.marks();
}

/** 012 Edge Cases: sets one span attribute on the marks the next typed text carries, keeping the others. */
export function setStoredSpan(tr: Transaction, state: EditorState, key: keyof SpanAttributes, value: string | null): void {
  const type = state.schema.marks["vestaSpan"];
  if (!type) return;
  const old = type.isInSet(nextMarks(state))?.attrs as SpanAttributes | undefined;
  const next: SpanAttributes = { ...emptyAttributes(), ...old, [key]: value };
  tr.removeStoredMark(type);
  if (next.color !== null || next.bg !== null || next.size !== null || next.underline || next.other.length > 0) tr.addStoredMark(type.create(next));
}

export function toggleHighlight(view: EditorView, scope: RangeScope = "details"): void {
  const state = view.state;
  const mark = state.schema.marks["mark"];
  if (!mark) return;
  const { from, to } = menuRange(state, scope);
  if (from === to) {
    // An empty paragraph: the next typed text gets the highlight, or loses it (Edge Cases).
    const span = state.schema.marks["vestaSpan"];
    const lit = mark.isInSet(nextMarks(state)) !== undefined || (span?.isInSet(nextMarks(state))?.attrs as SpanAttributes | undefined)?.bg != null;
    const tr = state.tr;
    if (lit) {
      tr.removeStoredMark(mark);
      setStoredSpan(tr, state, "bg", null);
    } else tr.addStoredMark(mark.create());
    view.dispatch(tr);
    return;
  }
  const action = highlightAction(chars(state, from, to));
  if (action === "disabled") return;
  const tr = state.tr;
  if (action === "remove") {
    tr.removeMark(from, to, mark);
    setSpanIn(tr, from, to, "bg", null);
  } else {
    const span = state.schema.marks["vestaSpan"];
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      const s = span?.isInSet(node.marks);
      const has = mark.isInSet(node.marks) !== undefined || (s !== undefined && (s.attrs as SpanAttributes).bg !== null);
      if (!has) tr.addMark(Math.max(from, pos), Math.min(to, pos + node.nodeSize), mark.create());
      return false;
    });
  }
  view.dispatch(tr);
}

// ---------------------------------------------------------------------------
// Block formats (FR-002 to FR-005)

function type(state: EditorState | Transaction, name: string): NodeType {
  const t = state.doc.type.schema.nodes[name];
  if (!t) throw new Error(`no node type ${name}`);
  return t;
}

/** Groups consecutive textblocks that are siblings of one parent, in document order. */
function siblingRuns(doc: ProseNode, blocks: readonly Textblock[]): Textblock[][] {
  const runs: Textblock[][] = [];
  let last: { parent: number; index: number } | null = null;
  for (const b of blocks) {
    const $p = doc.resolve(b.pos);
    const key = { parent: $p.depth === 0 ? -1 : $p.before($p.depth), index: $p.index() };
    const run = runs.at(-1);
    if (run !== undefined && last !== null && last.parent === key.parent && last.index + 1 === key.index) run.push(b);
    else runs.push([b]);
    last = key;
  }
  return runs;
}

function codeOff(tr: Transaction, blocks: readonly Textblock[]): void {
  const paragraph = type(tr, "paragraph");
  for (const b of [...blocks].reverse()) {
    const lines = b.node.textContent.split("\n").filter((l) => l.trim() !== "");
    const nodes = lines.length === 0 ? [paragraph.create()] : lines.map((l) => paragraph.create(null, tr.doc.type.schema.text(l)));
    tr.replaceWith(b.pos, b.pos + b.node.nodeSize, nodes);
  }
}

function codeOn(tr: Transaction, blocks: readonly Textblock[]): void {
  const code = type(tr, "code_block");
  for (const b of [...blocks].reverse()) tr.setBlockType(b.pos, b.pos + b.node.nodeSize, code, { language: "" });
}

/** The selected items of one list: its position and the first and last item index. */
interface ListPart {
  pos: number;
  first: number;
  last: number;
}

function listParts(doc: ProseNode, blocks: readonly Textblock[]): ListPart[] {
  const parts = new Map<number, ListPart>();
  for (const b of blocks) {
    if (b.info.listIndex === null) continue;
    const listPos = b.info.listIndex;
    const $item = doc.resolve(listPos + 1);
    const $b = doc.resolve(b.pos);
    const listDepth = $item.depth - 0; // depth of the list's content
    const index = $b.index(listDepth);
    const part = parts.get(listPos);
    if (part === undefined) parts.set(listPos, { pos: listPos, first: index, last: index });
    else {
      part.first = Math.min(part.first, index);
      part.last = Math.max(part.last, index);
    }
  }
  return [...parts.values()].sort((a, b) => b.pos - a.pos);
}

function relabel(items: readonly ProseNode[], kind: "bullet" | "ordered"): ProseNode[] {
  return items.map((item, i) =>
    item.type.create(
      { ...item.attrs, listType: kind, label: kind === "ordered" ? `${String(i + 1)}.` : "•" },
      item.content,
      item.marks,
    ),
  );
}

function children(node: ProseNode, from: number, to: number): ProseNode[] {
  const out: ProseNode[] = [];
  for (let i = from; i < to; i++) out.push(node.child(i));
  return out;
}

/** Replaces each list by: the items before, the changed items, the items after (FR-003, Edge Cases). */
function rebuildLists(tr: Transaction, parts: readonly ListPart[], middle: (items: ProseNode[], list: ProseNode) => ProseNode[]): void {
  for (const part of parts) {
    const list = tr.doc.nodeAt(part.pos);
    if (list === null) continue;
    const before = children(list, 0, part.first);
    const selected = children(list, part.first, part.last + 1);
    const after = children(list, part.last + 1, list.childCount);
    const nodes: ProseNode[] = [];
    if (before.length > 0) nodes.push(list.type.create(list.attrs, before));
    nodes.push(...middle(selected, list));
    if (after.length > 0) nodes.push(list.type.create(list.attrs, after));
    tr.replaceWith(part.pos, part.pos + list.nodeSize, nodes);
  }
}

function switchedList(tr: Transaction, kind: "bullet" | "ordered") {
  const listType = type(tr, kind === "bullet" ? "bullet_list" : "ordered_list");
  return (items: ProseNode[], list: ProseNode): ProseNode[] => {
    const spread = (list.attrs["spread"] as boolean | undefined) ?? false;
    return [listType.create(kind === "ordered" ? { order: 1, spread } : { spread }, relabel(items, kind))];
  };
}

const liftedItems = (items: ProseNode[]): ProseNode[] => items.flatMap((item) => children(item, 0, item.childCount));

function joinLists(tr: Transaction, kind: "bullet" | "ordered", from: number, to: number): void {
  const name = kind === "bullet" ? "bullet_list" : "ordered_list";
  for (;;) {
    const found: { at: number | null } = { at: null };
    tr.doc.nodesBetween(Math.max(0, from - 1), Math.min(tr.doc.content.size, to + 1), (node, pos, parent, index) => {
      if (found.at !== null) return false;
      if (node.type.name === name && parent !== null && index + 1 < parent.childCount && parent.child(index + 1).type.name === name) {
        const at = pos + node.nodeSize;
        if (canJoin(tr.doc, at)) found.at = at;
      }
      return found.at === null;
    });
    if (found.at === null) return;
    tr.join(found.at);
  }
}

function toggleList(state: EditorState, tr: Transaction, kind: "bullet" | "ordered", blocks: Textblock[], range: { from: number; to: number }): void {
  const action = blockAction(kind, blocks.map((b) => b.info));
  if (action.kind === "remove") {
    rebuildLists(tr, listParts(state.doc, blocks), liftedItems);
    return;
  }
  if (action.kind === "switch") {
    rebuildLists(tr, listParts(state.doc, blocks), switchedList(tr, kind));
    return;
  }
  // Apply (US1-6): switch the other kind's items, put each plain paragraph in its own item (013 FR-043, PRD Q171,
  // Q179: as Checklist does; a list item must begin with a paragraph, so headings and code blocks stay and split
  // the list), then join neighbors of the kind.
  const other = blocks.filter((b) => b.info.list !== null && b.info.list !== kind);
  rebuildLists(tr, listParts(state.doc, other), switchedList(tr, kind));
  const from = tr.mapping.map(range.from, -1);
  const to = tr.mapping.map(range.to, 1);
  const plain = textblocks(tr.doc, from, to).filter((b) => b.info.list === null && b.info.kind === "paragraph" && b.info.inCell !== true);
  const listType = type(tr, kind === "bullet" ? "bullet_list" : "ordered_list");
  const itemType = type(tr, "list_item");
  const itemAttrs = kind === "bullet" ? { listType: "bullet", label: "•", spread: false } : { listType: "ordered", label: "1.", spread: false };
  for (const run of siblingRuns(tr.doc, plain).reverse()) {
    const first = run[0] as Textblock;
    const last = run.at(-1) as Textblock;
    const items = run.map((b) => itemType.create(itemAttrs, b.node));
    tr.replaceWith(first.pos, last.pos + last.node.nodeSize, listType.create(kind === "ordered" ? { order: 1, spread: false } : { spread: false }, items));
  }
  joinLists(tr, kind, tr.mapping.map(range.from, -1), tr.mapping.map(range.to, 1));
}

function unquoteOne(tr: Transaction, blocks: readonly Textblock[]): void {
  const quote = type(tr, "blockquote");
  // Group by innermost quote, then lift each group out of it, from the end backwards.
  const groups = new Map<number, Textblock[]>();
  for (const b of blocks) {
    const $p = tr.doc.resolve(b.pos + 1);
    let at = -1;
    for (let d = $p.depth - 1; d >= 1; d--)
      if ($p.node(d).type === quote) {
        at = $p.before(d);
        break;
      }
    if (at < 0) continue;
    const g = groups.get(at) ?? [];
    g.push(b);
    groups.set(at, g);
  }
  for (const [, group] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    // 016 FR-026: an earlier lift (a deeper quote) moved the blocks; their positions follow it (inside the block, so
    // a block boundary never maps to the wrong side).
    const moved = group.map((b) => ({ ...b, pos: tr.mapping.map(b.pos + 1) - 1 }));
    for (const run of siblingRuns(tr.doc, moved).reverse()) {
      const first = run[0] as Textblock;
      const last = run.at(-1) as Textblock;
      const r = tr.doc.resolve(first.pos + 1).blockRange(tr.doc.resolve(last.pos + last.node.nodeSize - 1), (n) => n.type === quote);
      const target = r === null ? null : liftTarget(r);
      if (r !== null && target !== null) tr.lift(r, target);
    }
  }
}

function quoteRuns(tr: Transaction, blocks: readonly Textblock[]): void {
  const quote = type(tr, "blockquote");
  for (const run of siblingRuns(tr.doc, blocks).reverse()) {
    const first = run[0] as Textblock;
    const last = run.at(-1) as Textblock;
    const r = tr.doc.resolve(first.pos + 1).blockRange(tr.doc.resolve(last.pos + last.node.nodeSize - 1));
    const wrapping = r === null ? null : findWrapping(r, quote);
    if (r !== null && wrapping !== null) tr.wrap(r, wrapping);
  }
}

/** Bulleted list, Numbered list, Quote and Code block (FR-002 to FR-004). */
export function toggleBlock(view: EditorView, command: ToggleCommand): void {
  const state = view.state;
  const range = blockRangeOf(state);
  const blocks = textblocks(state.doc, range.from, range.to);
  if (blocks.length === 0) return;
  const tr = state.tr;
  if (command === "bullet" || command === "ordered") toggleList(state, tr, command, blocks, range);
  else if (command === "codeblock") {
    const action = blockAction("codeblock", blocks.map((b) => b.info));
    if (action.kind === "remove") codeOff(tr, blocks);
    else codeOn(tr, action.kind === "apply" ? action.targets.map((i) => blocks[i] as Textblock) : blocks);
  } else if (quoteAction(blocks.map((b) => b.info)) === "unquote-one") unquoteOne(tr, blocks);
  else quoteRuns(tr, blocks.filter((b) => b.info.quoteDepth === 0));
  if (tr.docChanged) view.dispatch(tr.scrollIntoView());
}

/** Cmd+' / Ctrl+': one more quote level for every block of the range, keeping their differences (FR-005). */
export function nestQuote(view: EditorView): boolean {
  const state = view.state;
  const { from, to } = blockRangeOf(state);
  const quote = state.schema.nodes["blockquote"];
  if (!quote) return false;
  const r = state.doc.resolve(from).blockRange(state.doc.resolve(to));
  const wrapping = r === null ? null : findWrapping(r, quote);
  if (r === null || wrapping === null) return false;
  view.dispatch(state.tr.wrap(r, wrapping).scrollIntoView());
  return true;
}

/** Shift+Code block: the range's blocks and the code blocks directly around them become one (FR-002a). */
export function mergeCodeBlocks(view: EditorView): void {
  const state = view.state;
  const code = state.schema.nodes["code_block"];
  if (!code) return;
  const { from, to } = blockRangeOf(state);
  const r = state.doc.resolve(from).blockRange(state.doc.resolve(to));
  if (r === null) return;
  const parent = r.parent;
  let first = r.startIndex;
  let last = r.endIndex - 1;
  let start = r.start;
  let end = r.end;
  if (first > 0 && parent.child(first - 1).type === code) {
    first--;
    start -= parent.child(first).nodeSize;
  }
  if (last + 1 < parent.childCount && parent.child(last + 1).type === code) {
    last++;
    end += parent.child(last).nodeSize;
  }
  const nodes = children(parent, first, last + 1);
  if (nodes.length === 1 && nodes[0]?.type === code) return;
  const language = (nodes.find((n) => n.type === code)?.attrs["language"] as string | undefined) ?? "";
  const lines: string[] = [];
  for (const n of nodes) {
    if (n.isTextblock) lines.push(n.textContent);
    else n.descendants((d) => (d.isTextblock ? (lines.push(d.textContent), false) : true));
  }
  const text = lines.join("\n");
  const block = code.create({ language }, text === "" ? null : state.schema.text(text));
  view.dispatch(state.tr.replaceWith(start, end, Fragment.from(block)).scrollIntoView());
}

// ---------------------------------------------------------------------------
// Checklist (012 FR-010 to FR-012, research §5)

/** The position of the nearest list item around a textblock, or null. */
function itemPos(doc: ProseNode, blockPos: number): number | null {
  const $p = doc.resolve(blockPos + 1);
  for (let d = $p.depth - 1; d >= 1; d--) if ($p.node(d).type.name === "list_item") return $p.before(d);
  return null;
}

function setChecked(tr: Transaction, positions: Iterable<number>, checked: boolean | null): void {
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (node !== null) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
  }
}

/**
 * 012 FR-010 to FR-012, one transaction: every paragraph and list item of the range gets an unchecked checkbox
 * (paragraphs become items of a bulleted list, consecutive ones one list), or, when all have one, only the
 * checkboxes go and the items stay in their list. Headings, code blocks and table cells are left as they are.
 */
export function toggleChecklist(view: EditorView, _scope: RangeScope): void {
  const state = view.state;
  const range = blockRangeOf(state);
  const blocks = textblocks(state.doc, range.from, range.to);
  const action = checklistAction(blocks.map((b) => b.info));
  if (action === "disabled") return;
  const tr = state.tr;
  const items = new Set<number>();
  for (const b of blocks) {
    if (b.info.kind !== "paragraph" || b.info.inCell === true || b.info.list === null) continue;
    const at = itemPos(state.doc, b.pos);
    if (at !== null && (action === "remove" || b.info.checked === null)) items.add(at);
  }
  if (action === "remove") {
    removeChecklist(tr, items);
    if (tr.docChanged) view.dispatch(tr.scrollIntoView());
    return;
  }
  setChecked(tr, items, false);
  // Plain paragraphs: wrapped run by run, then their new items get a checkbox.
  const from = tr.mapping.map(range.from, -1);
  const to = tr.mapping.map(range.to, 1);
  const plain = textblocks(tr.doc, from, to).filter((b) => b.info.list === null && b.info.kind === "paragraph" && b.info.inCell !== true);
  const listType = type(tr, "bullet_list");
  const itemType = type(tr, "list_item");
  // One item per paragraph, so each line keeps its own checkbox.
  for (const run of siblingRuns(tr.doc, plain).reverse()) {
    const first = run[0] as Textblock;
    const last = run.at(-1) as Textblock;
    const items = run.map((b) => itemType.create({ listType: "bullet", label: "•", checked: false }, b.node));
    tr.replaceWith(first.pos, last.pos + last.node.nodeSize, listType.create({ spread: false }, items));
  }
  joinLists(tr, "bullet", tr.mapping.map(range.from, -1), tr.mapping.map(range.to, 1));
  if (tr.docChanged) view.dispatch(tr.scrollIntoView());
}

/**
 * 016 FR-025 (PRD Q231): the checkboxes go, list by list. A list whose every item loses its box, that is not inside an
 * item and has no bulleted or numbered list directly above or below it, becomes paragraphs; any other keeps its items
 * as plain items (012's rule).
 */
function removeChecklist(tr: Transaction, items: ReadonlySet<number>): void {
  const lists = new Map<number, number[]>();
  for (const pos of items) {
    const at = tr.doc.resolve(pos).before();
    lists.set(at, [...(lists.get(at) ?? []), pos]);
  }
  const lifts: number[] = [];
  for (const [listPos, mine] of lists) {
    const list = tr.doc.nodeAt(listPos);
    const $list = tr.doc.resolve(listPos);
    if (list === null) continue;
    const parent = $list.parent;
    const index = $list.index();
    const isList = (n: ProseNode | null | undefined) => n !== null && n !== undefined && LISTS.has(n.type.name);
    const decision = checklistOff({
      coversAll: mine.length === list.childCount,
      nestedInItem: parent.type.name === "list_item",
      prevIsList: index > 0 && isList(parent.maybeChild(index - 1)),
      nextIsList: isList(parent.maybeChild(index + 1)),
    });
    if (decision === "lift") lifts.push(listPos);
    else setChecked(tr, mine, null);
  }
  // From the end, so the earlier positions stay valid.
  for (const listPos of lifts.sort((a, b) => b - a)) {
    const list = tr.doc.nodeAt(listPos);
    if (list === null) continue;
    const blocks: ProseNode[] = [];
    list.forEach((item) => {
      item.forEach((child) => blocks.push(child));
    });
    tr.replaceWith(listPos, listPos + list.nodeSize, Fragment.fromArray(blocks));
  }
}

/**
 * 016 FR-023, FR-024 (PRD Q225, Q240, Q253): `[]`, `[ ]`, `[x]` or `[X]` and a space at the start of a paragraph in the
 * details: the paragraph becomes a one-item checklist (inside its quote, if any), a list item's first paragraph gives
 * its item the typed state; elsewhere nothing (null), the characters stay. Its own Undo step, so Undo right after
 * brings the characters back.
 */
export function typedChecklist(state: EditorState, checked: boolean, start: number, end: number): Transaction | null {
  const $start = state.doc.resolve(start);
  const block = $start.parent;
  if (!block.isTextblock || $start.parentOffset !== 0) return null;
  const blockPos = $start.before();
  const inItem = $start.depth >= 2 && $start.node(-1).type.name === "list_item";
  const action = checklistShortcut({ scope: "details", block: infoAt(state.doc, blockPos, block), firstInItem: inItem && $start.index(-1) === 0 });
  if (action === "none") return null;
  const tr = closeHistory(state.tr).delete(start, end);
  if (action === "set") {
    setChecked(tr, [$start.before(-1)], checked);
    return tr;
  }
  const paragraph = tr.doc.nodeAt(blockPos);
  if (paragraph === null) return null;
  const item = type(tr, "list_item").create({ listType: "bullet", label: "•", checked }, paragraph);
  const list = type(tr, "bullet_list").create({ spread: false }, item);
  tr.replaceWith(blockPos, blockPos + paragraph.nodeSize, list);
  // The cursor stays before the text that followed it, now in the item; a bulleted list right above or below takes it
  // in, as Checklist does.
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 3));
  joinLists(tr, "bullet", blockPos, blockPos + list.nodeSize);
  return tr;
}

// ---------------------------------------------------------------------------
// Indent and outdent (012 FR-006 to FR-009, research §4)

/** The positions of every list item around a textblock, innermost first. */
function itemPositions(doc: ProseNode, blockPos: number): number[] {
  const $p = doc.resolve(blockPos + 1);
  const out: number[] = [];
  for (let d = $p.depth - 1; d >= 1; d--) if ($p.node(d).type.name === "list_item") out.push($p.before(d));
  return out;
}

/**
 * Each list item of the range one level deeper, under the item before it, in every list the range touches; an item
 * inside another selected item moves with it; a first item stays (Edge Cases). One Undo step.
 */
export function indentItems(view: EditorView, _scope: RangeScope): boolean {
  const state = view.state;
  const item = state.schema.nodes["list_item"];
  if (!item) return false;
  const range = blockRangeOf(state);
  const blocks = textblocks(state.doc, range.from, range.to);
  if (indentAction(blocks.map((b) => b.info), 1) === "disabled") return false;
  const selected = new Set(blocks.flatMap((b) => (b.info.list === null ? [] : [itemPositions(state.doc, b.pos)[0] as number])));
  const targets = blocks.filter(
    (b) =>
      b.info.list !== null &&
      b.info.hasPrevSibling === true &&
      b.info.inCell !== true &&
      !itemPositions(state.doc, b.pos)
        .slice(1)
        .some((p) => selected.has(p)),
  );
  // First to last: a later item's position is mapped through the earlier moves.
  const tr = state.tr;
  for (const b of targets) {
    const current = state.apply(tr);
    const at = tr.mapping.map(b.pos + 1);
    const placed = current.apply(current.tr.setSelection(TextSelection.create(current.doc, at)));
    sinkListItem(item)(placed, (t) => {
      for (const step of t.steps) tr.step(step);
    });
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Each nested list item of the range one level up; top-level items stay in their list; one Undo step. */
export function outdentItems(view: EditorView, _scope: RangeScope): boolean {
  const state = view.state;
  const item = state.schema.nodes["list_item"];
  if (!item) return false;
  const range = blockRangeOf(state);
  const blocks = textblocks(state.doc, range.from, range.to);
  if (indentAction(blocks.map((b) => b.info), -1) === "disabled") return false;
  // The nested items, lifted from the last to the first so earlier positions stay valid.
  const nested = blocks.filter((b) => b.info.list !== null && (b.info.depth ?? 1) > 1).reverse();
  const tr = state.tr;
  let current = state;
  for (const b of nested) {
    const at = tr.mapping.map(b.pos + 1);
    const at2 = current.apply(current.tr.setSelection(TextSelection.create(current.doc, at)));
    liftListItem(item)(at2, (t) => {
      for (const step of t.steps) tr.step(step);
      current = state.apply(tr);
    });
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr.scrollIntoView());
  return true;
}

// ---------------------------------------------------------------------------
// Font size (012 FR-014 to FR-017, research §6)

/** The size of each text node of the range, null for the default. */
export function sizesIn(state: EditorState, scope: RangeScope): (string | null)[] {
  const span = state.schema.marks["vestaSpan"];
  const { from, to } = menuRange(state, scope);
  // An empty paragraph: the size the next typed text will have.
  if (from === to) return [(span?.isInSet(nextMarks(state))?.attrs as SpanAttributes | undefined)?.size ?? null];
  const sizes: (string | null)[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    sizes.push((span?.isInSet(node.marks)?.attrs as SpanAttributes | undefined)?.size ?? null);
    return false;
  });
  return sizes;
}

/** Every part of the range one step up (1) or down (-1) the ladder from its own size; one Undo step. */
export function stepFontSize(view: EditorView, scope: RangeScope, dir: 1 | -1): boolean {
  const state = view.state;
  const span = state.schema.marks["vestaSpan"];
  if (!span || !canStep(sizesIn(state, scope), dir)) return false;
  const { from, to } = menuRange(state, scope);
  if (from === to) {
    const [current = null] = sizesIn(state, scope);
    const tr = state.tr;
    setStoredSpan(tr, state, "size", stepSize(current, dir));
    view.dispatch(tr);
    return true;
  }
  const parts: { s: number; e: number; size: string | null }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const size = (span.isInSet(node.marks)?.attrs as SpanAttributes | undefined)?.size ?? null;
    parts.push({ s: Math.max(from, pos), e: Math.min(to, pos + node.nodeSize), size });
    return false;
  });
  const tr = state.tr;
  for (const { s, e, size } of parts) {
    // A part that is only spaces keeps its size: a size span around spaces alone writes as an empty span.
    if (tr.doc.textBetween(s, e).trim() === "") continue;
    const next = stepSize(size, dir);
    if (next !== size) setSpanIn(tr, s, e, "size", next);
  }
  if (!tr.docChanged) return false;
  view.dispatch(tr);
  return true;
}

// The floating editing menu (005 US3, FR-023 to FR-026): one per editor, placed right after the editor in the
// tab order (a toolbar with one tab stop and arrow keys), positioned above the selection or, with nothing
// selected, above the editor. With a selection it formats the selection; without one, the whole field.
import type { MarkType, Node as ProseNode } from "@milkdown/kit/prose/model";
import { AllSelection, NodeSelection, Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { SCOPES, type Feature } from "../../../domain/markdown/scope";
import { menuLabel, type MenuLabel } from "../../../domain/editing/scope";
import { emptyAttributes, type SpanAttributes } from "../../../domain/markdown/spans";
import { shiftEnterKey, t, type MessageKey } from "../../i18n/t";
import {
  describeRange,
  indentItems,
  menuRange,
  mergeCodeBlocks,
  nestQuote,
  outdentItems,
  pressedStates,
  sizesIn,
  stepFontSize,
  toggleBlock,
  toggleChecklist,
  toggleHighlight,
} from "./block-toggles";
import { checklistAction, indentAction } from "../../../domain/editing/toggles";
import { canStep } from "../../../domain/editing/font-size";
import { createColorPicker, currentColor, memoryPort, textSwatch, type ColorListsPort } from "./color-picker";
import { createTableSizeGrid } from "./table-size";
import { TABLE_ACTIONS, TABLE_ACTION_LABEL, applicableActions, runTableAction, type TableAction } from "../table-handles";
import { DEFAULT_TABLE } from "../../../domain/editing/table-size";
import { longPress, type LongPress } from "./long-press";
import { OPTION_SYMBOL, svgSymbol } from "../../components/symbols";
import { classifyAddress } from "../../../domain/markdown/links";
import { linkRuns } from "../links";

import { SNAPSHOT_IDS, type FormatSnapshot, type SnapshotId } from "../../../domain/menu/state";

export type MenuScope = "title" | "reminder" | "details";
export type BlockCommand = "bullet" | "ordered" | "quote" | "codeblock" | "hr" | "table";

export interface MenuOptions {
  scope: MenuScope;
  /** Runs one of Milkdown's block commands on the current selection. */
  runCommand: (command: BlockCommand) => void;
  /** Inserts a stored file or image (US4); the option is hidden without it. */
  onInsert?: () => void;
  /** A `file:` URL or absolute path typed as a link becomes a stored file (FR-027a), linked over `range`. */
  onLinkPath?: (path: string, range: { from: number; to: number }) => void;
  /** 011 FR-014: the store's pinned and recent colors; in memory when absent (unit tests). */
  colors?: ColorListsPort;
  /** 011 FR-018 to FR-020: inserts a table (rows count the header) in one transaction. */
  insertTable?: (cols: number, rows: number) => void;
  /** 011 FR-020b: the Rows before columns setting. */
  tableRowsFirst?: () => boolean;
}

export interface FloatingMenu {
  readonly element: HTMLElement;
  /** Re-reads the selection: placement, label and pressed states. */
  refresh(): void;
  show(): void;
  hide(): void;
  /** Focus is in the menu, or its link panel is open: Esc belongs to the menu (FR-026). */
  ownsEscape(): boolean;
  /** Closes the link panel, or leaves the menu, and puts the focus back in the editor. */
  escape(): void;
  contains(node: Node | null): boolean;
  /** Elements outside the menu that count as the menu for focus (the color picker on document.body). */
  readonly extraFocusRoots: readonly HTMLElement[];
  /** True while the menu moves focus inside itself (a picker row being rebuilt): not the edit ending. */
  holdsFocus(): boolean;
  /** Re-reads every label from the current language (007 research §4). */
  relabel(): void;
  /** 013 research §4: runs an option by id as its button does; false when the option is not offered or disabled. */
  run(id: string, shift?: boolean): boolean;
  /** 013 FR-016: what the menu offers, pressed and disabled now, read from the editor's state. */
  snapshot(): FormatSnapshot;
  /** 016 FR-013, FR-016c: the link panel on the selection; `refused` shows the stored address's refusal line. */
  openLinkPanel(opts?: { refused?: boolean }): boolean;
  /** 013 Format › Insert Table…: the size grid, with the focus in it (as Shift+Enter on the Table button). */
  openSizeGrid(): boolean;
  destroy(): void;
}

const TABLE_GLYPH: Readonly<Record<TableAction, string>> = {
  "row-above": "↥",
  "row-below": "↧",
  "col-left": "↤",
  "col-right": "↦",
  "row-delete": "⊟",
  "col-delete": "⊠",
  "table-delete": "⌧",
};

export type Option = {
  id: string;
  label: MessageKey;
  text: string;
  /** Shows only when the scope has this feature. */
  feature: Feature;
  kind?: "button" | "color";
  details?: boolean;
};

export const OPTIONS: readonly Option[] = [
  { id: "strong", label: "fmBold", text: "B", feature: "bold-italic-code-links" },
  { id: "emphasis", label: "fmItalic", text: "I", feature: "bold-italic-code-links" },
  { id: "underline", label: "fmUnderline", text: "U", feature: "strikethrough-underline" },
  { id: "strike_through", label: "fmStrike", text: "S", feature: "strikethrough-underline" },
  { id: "inlineCode", label: "fmCode", text: "</>", feature: "bold-italic-code-links" },
  // 013 FR-039, FR-041: Text color is an A over a swatch of the current color; Highlight an A on the current highlight.
  { id: "color", label: "fmColor", text: "A", feature: "text-color", kind: "color" },
  { id: "mark", label: "fmHighlight", text: "A", feature: "highlight" },
  // 012 FR-014: one step up or down the size ladder, in every scope.
  { id: "size-up", label: "fmSizeUp", text: "A⁺", feature: "font-size-headings" },
  { id: "size-down", label: "fmSizeDown", text: "A⁻", feature: "font-size-headings" },
  { id: "heading", label: "fmHeading", text: "H", feature: "font-size-headings" },
  { id: "bullet", label: "fmBullet", text: "•", feature: "lists-quotes" },
  { id: "ordered", label: "fmOrdered", text: "1.", feature: "lists-quotes" },
  { id: "check", label: "fmCheck", text: "☑", feature: "checklists" },
  // 012 FR-006 to FR-008: details only (lists are details only, A5).
  { id: "indent", label: "fmIndent", text: "⇥", feature: "lists-quotes" },
  // 012 FR-013: a pair of filled double quotation marks, as newspapers print before a quote.
  { id: "quote", label: "fmQuote", text: "❝", feature: "lists-quotes" },
  { id: "codeblock", label: "fmCodeBlock", text: "{ }", feature: "code-blocks" },
  { id: "hr", label: "fmHr", text: "—", feature: "line-breaks-rules" },
  { id: "table", label: "fmTable", text: "▦", feature: "tables" },
  // 011 FR-021: shown only while the cursor is in a table, each when it applies.
  ...TABLE_ACTIONS.map((id): Option => ({ id, label: TABLE_ACTION_LABEL[id], text: TABLE_GLYPH[id], feature: "tables" })),
  { id: "link", label: "fmLink", text: "🔗", feature: "bold-italic-code-links" },
  { id: "insert", label: "fmInsert", text: "📎", feature: "inline-images" },
];


/** 012 FR-002: the locale key of each label. */
const LABEL_KEY: Readonly<Record<Exclude<MenuLabel, "whole">, MessageKey>> = {
  all: "fmAll_details",
  selection: "fmSel",
  paragraph: "fmScope_paragraph",
  heading: "fmScope_heading",
  listItem: "fmScope_listItem",
  quote: "fmScope_quote",
  code: "fmScope_code",
  cell: "fmScope_cell",
};

let scopeIds = 0;

/** 012 FR-002a, FR-002b: the options that format text, disabled where markdown cannot hold them. */
const INLINE_OPTIONS = new Set(["strong", "emphasis", "underline", "strike_through", "inlineCode", "mark", "color", "bg", "link", "size", "size-up", "size-down"]);

/** True when the range holds no text that inline formats can apply to: all code, or a selected block with no text. */
function inlineUnavailable(view: EditorView): boolean {
  const sel = view.state.selection;
  if (sel instanceof NodeSelection) return !sel.node.isTextblock;
  if (sel.empty) return sel.$from.parent.type.name === "code_block";
  const seen = { any: false, allCode: true };
  view.state.doc.nodesBetween(sel.from, sel.to, (node) => {
    if (!node.isTextblock) return true;
    seen.any = true;
    if (node.type.name !== "code_block") seen.allCode = false;
    return false;
  });
  return seen.any && seen.allCode;
}

/** 012 FR-002: what the menu's next change applies to, read from the selection (research §2). */
function labelOf(view: EditorView, scope: MenuScope): MenuLabel {
  const sel = view.state.selection;
  const doc = view.state.doc;
  const $from = sel.$from;
  const path: string[] = [];
  for (let d = $from.depth; d >= 1; d--) path.push($from.node(d).type.name);
  const coversAll = sel instanceof AllSelection || (sel.from <= Selection.atStart(doc).from && sel.to >= Selection.atEnd(doc).to);
  return menuLabel({ empty: sel.empty, coversAll, path }, scope);
}
const GAP = 8;

/** The selection; with none, the whole title or reminder, or the block holding the cursor in the details (012 FR-001). */
function rangeOf(view: EditorView, scope: MenuScope): { from: number; to: number } {
  return menuRange(view.state, scope);
}

function textNodes(
  view: EditorView,
  from: number,
  to: number,
  fn: (node: ProseNode, s: number, e: number) => void,
): void {
  view.state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) fn(node, Math.max(from, pos), Math.min(to, pos + node.nodeSize));
  });
}

function allHave(view: EditorView, scope: MenuScope, type: MarkType, pred?: (attrs: SpanAttributes) => boolean): boolean {
  const { from, to } = rangeOf(view, scope);
  if (from === to) {
    // An empty paragraph: the marks the next typed text will carry (Edge Cases).
    const mark = type.isInSet(view.state.storedMarks ?? view.state.selection.$from.marks());
    return mark !== undefined && (!pred || pred(mark.attrs as SpanAttributes));
  }
  const seen = { any: false, all: true };
  textNodes(view, from, to, (node) => {
    seen.any = true;
    const mark = type.isInSet(node.marks);
    if (!mark || (pred && !pred(mark.attrs as SpanAttributes))) seen.all = false;
  });
  return seen.any && seen.all;
}

function toggleMark(view: EditorView, scope: MenuScope, type: MarkType): void {
  const { from, to } = rangeOf(view, scope);
  const tr = view.state.tr;
  const on = allHave(view, scope, type);
  if (from === to) {
    if (on) tr.removeStoredMark(type);
    else tr.addStoredMark(type.create());
  } else if (on) tr.removeMark(from, to, type);
  else tr.addMark(from, to, type.create());
  view.dispatch(tr);
}

/** Sets one span attribute on every text node of the range, keeping the others (one span, FR-015). */
function setSpan(view: EditorView, scope: MenuScope, key: "color" | "bg" | "size" | "underline", value: string | boolean | null): void {
  const type = view.state.schema.marks["vestaSpan"];
  if (!type) return;
  const { from, to } = rangeOf(view, scope);
  const tr = view.state.tr;
  if (from === to) {
    const old = type.isInSet(view.state.storedMarks ?? view.state.selection.$from.marks());
    const attrs: SpanAttributes = { ...emptyAttributes(), ...(old?.attrs as SpanAttributes | undefined), [key]: value };
    tr.removeStoredMark(type);
    if (attrs.color !== null || attrs.bg !== null || attrs.size !== null || attrs.underline || attrs.other.length > 0) tr.addStoredMark(type.create(attrs));
    view.dispatch(tr);
    return;
  }
  textNodes(view, from, to, (node, s, e) => {
    const old = type.isInSet(node.marks);
    const attrs: SpanAttributes = { ...emptyAttributes(), ...(old?.attrs as SpanAttributes | undefined), [key]: value };
    tr.removeMark(s, e, type);
    if (attrs.color !== null || attrs.bg !== null || attrs.size !== null || attrs.underline || attrs.other.length > 0) {
      tr.addMark(s, e, type.create(attrs));
    }
  });
  view.dispatch(tr);
}

function headingLevel(view: EditorView, whole: boolean): number {
  const { from, to } = whole ? { from: 0, to: view.state.doc.content.size } : rangeOf(view, "details");
  const found: { level: number | null } = { level: null };
  view.state.doc.nodesBetween(from, to, (node) => {
    if (found.level === null && node.isTextblock) {
      found.level = node.type.name === "heading" ? Number(node.attrs.level) : 0;
      return false;
    }
    return true;
  });
  return found.level ?? 0;
}

/** Cycles none → H1 → H2 → H3; a title's heading covers the whole title (FR-024a). */
function cycleHeading(view: EditorView, whole: boolean): void {
  const { from, to } = whole ? { from: 0, to: view.state.doc.content.size } : rangeOf(view, "details");
  const next = (headingLevel(view, whole) + 1) % 4;
  const { heading, paragraph } = view.state.schema.nodes;
  if (!heading || !paragraph) return;
  view.dispatch(
    view.state.tr.setBlockType(from, to, next === 0 ? paragraph : heading, next === 0 ? null : { level: next }),
  );
}

/** 013 Format › Heading: sets one level directly (0 is a paragraph), in one transaction (one Undo step). */
export function setHeading(view: EditorView, level: number, whole: boolean): void {
  const { from, to } = whole ? { from: 0, to: view.state.doc.content.size } : rangeOf(view, "details");
  const { heading, paragraph } = view.state.schema.nodes;
  if (!heading || !paragraph) return;
  view.dispatch(view.state.tr.setBlockType(from, to, level === 0 ? paragraph : heading, level === 0 ? null : { level }));
}

/**
 * 012 FR-034: a disabled option keeps its place in the toolbar's arrow-key roving and is announced as
 * unavailable (aria-disabled, never the disabled attribute); activating it does nothing.
 */
export function setDisabled(button: HTMLElement, on: boolean): void {
  if (on) button.setAttribute("aria-disabled", "true");
  else button.removeAttribute("aria-disabled");
}

const isDisabled = (button: HTMLElement | undefined): boolean => button?.getAttribute("aria-disabled") === "true";

/** A button's tooltip: its label, plus the hint for its second action (011 FR-028). */
function titleFor(id: string, label: MessageKey): string {
  const shift = t("keyShift");
  const shiftEnter = shiftEnterKey();
  if (id === "codeblock") return `${t(label)} · ${t("fmMergeHint", { shift, shiftEnter })}`;
  if (id === "table") return `${t(label)} · ${t("fmTableHint", { shiftEnter })}`;
  if (id === "indent") return `${t(label)} · ${t("fmIndentHint", { shift, shiftEnter })}`;
  if (id === "mark") return `${t(label)} · ${t("fmHighlightHint", { shiftEnter })}`;
  return t(label);
}

export function createFloatingMenu(view: EditorView, options: MenuOptions): FloatingMenu {
  const features = SCOPES[options.scope === "details" ? "details" : "title"];
  const el = document.createElement("div");
  el.className = "fmenu";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", t("fmLabel"));
  el.hidden = true;

  const scopeLabel = document.createElement("span");
  scopeLabel.className = "fm-scope";
  // 012 FR-004: the label describes the toolbar, so it is read when the focus enters the menu, never while typing.
  scopeLabel.id = `fm-scope-${String(++scopeIds)}`;
  el.setAttribute("aria-describedby", scopeLabel.id);
  el.append(scopeLabel);
  // 014 FR-014 to FR-017 (PRD Q196): two rows of the same length. OPTIONS is the one fixed sequence; the scope's shown
  // options are split evenly, the first row taking the odd one. 018 FR-036 (PRD Q286): the table options take a third
  // row, shown while the cursor is in a table, which never widens the menu, so no button moves sideways.
  const rows = [document.createElement("div"), document.createElement("div"), document.createElement("div")];
  for (const row of rows) {
    row.className = "fm-row";
    el.append(row);
  }
  const tableRow = rows[2] as HTMLDivElement;
  tableRow.classList.add("fm-table-row");
  tableRow.hidden = true;

  const controls: HTMLElement[] = [];
  const buttons = new Map<string, HTMLButtonElement>();
  // Every element with a localized name, so a language switch can re-label them (007 research §4).
  const labelled: { el: HTMLElement; key: MessageKey; title: boolean }[] = [];
  const shownOptions = OPTIONS.filter((option) => {
    // "Insert" stands for files and images in details (local-files), images only in titles (inline-images).
    if (option.id === "insert") return options.onInsert !== undefined && (features.includes("inline-images") || features.includes("local-files"));
    return features.includes(option.feature);
  });
  const isTableAction = (id: string) => (TABLE_ACTIONS as readonly string[]).includes(id);
  const main = shownOptions.filter((o) => !isTableAction(o.id));
  const split = Math.ceil(main.length / 2);
  for (const option of shownOptions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = option.kind === "color" ? `fm-b fm-color fm-${option.id}` : option.id === "mark" ? "fm-b fm-color fm-hl" : "fm-b";
    // 011 FR-008: the color options open the shared picker.
    // 013 FR-042: Highlight opens the highlight picker on a long press or Shift+Enter.
    if (option.kind === "color" || option.id === "table" || option.id === "mark") {
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-expanded", "false");
    }
    button.dataset.cmd = option.id;
    // The glyph is decoration; the button's name is its label (WCAG 2.5.3 through aria-label). 013 FR-041: an outline
    // symbol, or a styled letter for B, I, U, S, H and the two A buttons.
    const symbol = OPTION_SYMBOL[option.id];
    if (symbol !== undefined) button.append(svgSymbol(symbol));
    else {
      const glyph = document.createElement("span");
      glyph.setAttribute("aria-hidden", "true");
      glyph.dataset.glyph = option.text;
      button.append(glyph);
    }
    button.title = titleFor(option.id, option.label);
    button.setAttribute("aria-label", t(option.label));
    button.tabIndex = -1;
    labelled.push({ el: button, key: option.label, title: true });
    (isTableAction(option.id) ? tableRow : main.indexOf(option) < split ? rows[0] : rows[1])?.append(button);
    controls.push(button);
    buttons.set(option.id, button);
  }
  // The keyboard goes through the rows in order: the table options after the second row (FR-036).
  controls.sort((a, b) => rows.findIndex((r) => r.contains(a)) - rows.findIndex((r) => r.contains(b)));
  const first = controls[0];
  if (first) first.tabIndex = 0;

  // 011 FR-019: a press held 500 ms on Table opens the size grid; a shorter one is a click (default table).
  // 011 FR-018, 013 FR-042: a long press opens the size grid on Table and the highlight picker on Highlight.
  const presses: { id: string; press: LongPress }[] = [];
  const tableButton = buttons.get("table");
  if (tableButton) presses.push({
      id: "table",
      press: longPress(tableButton, () => {
        sizeGrid.open(tableButton, false);
      }),
    });
  // 016 FR-021: a press held 500 ms on Text color opens the text color picker.
  const colorButton = buttons.get("color");
  if (colorButton) presses.push({
      id: "color",
      press: longPress(colorButton, () => {
        picker.open("color", colorButton, false);
      }),
    });
  const markButton = buttons.get("mark");
  if (markButton) presses.push({
      id: "mark",
      press: longPress(markButton, () => {
        picker.open("bg", markButton, false);
      }),
    });


  // 016 FR-013 (PRD Q233): the link panel: Link text, Link, a refusal line, then Apply, Remove link and Cancel. The
  // buttons are in that order for Tab; the stylesheet shows Remove link at the left, Cancel and Apply at the right.
  const linkPanel = document.createElement("div");
  linkPanel.className = "fm-linkpanel";
  linkPanel.hidden = true;
  linkPanel.setAttribute("role", "group");
  const linkField = (name: string): { label: HTMLLabelElement; caption: HTMLSpanElement; input: HTMLInputElement } => {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    const input = document.createElement("input");
    input.type = "text";
    input.name = name;
    input.spellcheck = false;
    label.append(caption, input);
    return { label, caption, input };
  };
  const textField = linkField("link-text");
  const hrefField = linkField("link-href");
  const linkText = textField.input;
  const linkHref = hrefField.input;
  const linkError = document.createElement("p");
  linkError.className = "fm-link-error";
  linkError.setAttribute("role", "alert");
  linkError.hidden = true;
  const linkActions = document.createElement("div");
  linkActions.className = "fm-link-actions";
  const linkButton = (act: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.act = act;
    linkActions.append(b);
    return b;
  };
  const linkApply = linkButton("apply");
  const linkRemove = linkButton("remove");
  const linkCancel = linkButton("cancel");
  linkApply.classList.add("primary");
  linkPanel.append(textField.label, hrefField.label, linkError, linkActions);
  el.append(linkPanel);
  let linkTarget: { from: number; to: number; links: number } | null = null;
  function labelLinkPanel(): void {
    linkPanel.setAttribute("aria-label", t("fmLink"));
    textField.caption.textContent = t("linkText");
    hrefField.caption.textContent = t("linkHref");
    linkApply.textContent = t("linkApply");
    linkRemove.textContent = t("linkRemove");
    linkCancel.textContent = t("cancel");
  }
  labelLinkPanel();

  const marks = view.state.schema.marks;
  const spanType = marks["vestaSpan"];
  const whole = options.scope !== "details";
  const scope = options.scope;
  const colorsPort = options.colors ?? memoryPort();
  const picker = createColorPicker(
    view,
    colorsPort,
    () => {
      refresh();
    },
    scope,
  );
  const sizeGrid = createTableSizeGrid({
    rowsFirst: options.tableRowsFirst ?? (() => false),
    onInsert: (cols, rows) => {
      options.insertTable?.(cols, rows);
      view.focus();
      refresh();
    },
  });

  function run(id: string, shift = false): boolean {
    // 013 Format › Heading › None, Heading 1 … 6.
    const level = /^heading-([0-6])$/.exec(id)?.[1];
    if (level !== undefined) {
      if (!buttons.has("heading")) return false;
      setHeading(view, Number(level), whole);
      view.focus();
      refresh();
      return true;
    }
    // 013 FR-042: Format › Highlight Color… opens the highlight picker at the Highlight button.
    if (id === "bg") {
      const mark = buttons.get("mark");
      if (mark === undefined) return false;
      picker.open("bg", mark, true);
      return true;
    }
    // 013 research §4: an option the scope does not offer does nothing (the Format menu disables it too).
    if (!buttons.has(id)) return false;
    // Shift on Indent outdents, which a first nested item allows even when Indent itself does not.
    if (isDisabled(buttons.get(id)) && !(id === "indent" && shift)) return false;
    const markType = marks[id];
    if (id === "color") {
      const button = buttons.get(id);
      if (button) picker.open(id, button, true);
      return true;
    }
    if ((TABLE_ACTIONS as readonly string[]).includes(id)) {
      runTableAction(view, id as TableAction);
    } else if (id === "mark") {
      toggleHighlight(view, scope);
    } else if (id === "codeblock" && shift) {
      mergeCodeBlocks(view);
    } else if (id === "quote" && shift) {
      // 016 FR-026 (PRD Q232): Shift+click or Shift+Enter on Quote nests one level deeper, as Cmd/Ctrl+' does.
      nestQuote(view);
    } else if (id === "bullet" || id === "ordered" || id === "quote" || id === "codeblock") {
      toggleBlock(view, id);
    } else if (markType && id !== "link") {
      toggleMark(view, scope, markType);
    } else if (id === "underline" && spanType) {
      setSpan(view, scope, "underline", !allHave(view, scope, spanType, (a) => a.underline));
    } else if (id === "size-up" || id === "size-down") {
      stepFontSize(view, scope, id === "size-up" ? 1 : -1);
    } else if (id === "heading") {
      cycleHeading(view, whole);
    } else if (id === "link") {
      // 016 FR-015: the Link button opens the panel; it no longer toggles a link off (Remove link does).
      openLinkPanel();
      return true;
    } else if (id === "insert") {
      options.onInsert?.();
      return true;
    } else if (id === "check") {
      toggleChecklist(view, scope);
    } else if (id === "indent") {
      if (shift) outdentItems(view, scope);
      else indentItems(view, scope);
    } else if (id === "hr") {
      // Inserted after the top-level block the selection ends in, never inside a list or a quote; one
      // transaction, so one Undo removes it (011 FR-007).
      const paragraph = view.state.schema.nodes["paragraph"];
      const rule = view.state.schema.nodes["hr"];
      const $end = view.state.doc.resolve(view.state.selection.to);
      const at = $end.depth > 0 ? $end.after(1) : view.state.doc.content.size;
      if (paragraph && rule) {
        const tr = view.state.tr.insert(at, [rule.create(), paragraph.create()]);
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + rule.create().nodeSize + 1)).scrollIntoView());
      }
    } else if (id === "table" && options.insertTable !== undefined) {
      options.insertTable(DEFAULT_TABLE.cols, DEFAULT_TABLE.rows);
    } else if (id === "table") {
      // Inserted after the top-level block the selection ends in, never inside a list or a quote.
      const paragraph = view.state.schema.nodes["paragraph"];
      const $end = view.state.doc.resolve(view.state.selection.to);
      const at = $end.depth > 0 ? $end.after(1) : view.state.doc.content.size;
      if (paragraph) {
        const tr = view.state.tr.insert(at, paragraph.create());
        view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)));
      }
      options.runCommand(id);
    }
    view.focus();
    refresh();
    return true;
  }

  // 016 FR-013 to FR-015a (PRD Q233, Q245, Q251): the link panel, at the menu's spot in place of its rows.
  /** 016 FR-020: every character of the range has the swatch as its stored color (never the color as drawn). */
  function textColorOn(): boolean {
    const hex = textSwatch(colorsPort);
    return spanType !== undefined && allHave(view, scope, spanType, (a) => a.color === hex);
  }

  /** 016 FR-020: one transaction (one Undo step); the recent colors stay as they are. */
  function toggleTextColor(): void {
    setSpan(view, scope, "color", textColorOn() ? null : textSwatch(colorsPort));
    view.focus();
    refresh();
  }

  function openLinkPanel(opts: { refused?: boolean } = {}): boolean {
    const type = marks["link"];
    if (type === undefined || !buttons.has("link")) return false;
    const sel = view.state.selection;
    // With nothing selected, the details insert at the cursor; a title or reminder takes its whole text (PRD A5).
    const base = sel.empty && scope === "details" ? { from: sel.from, to: sel.to } : rangeOf(view, scope);
    const runs = linkRuns(view.state, base.from, base.to);
    const one = runs.length === 1 ? runs[0] : undefined;
    // The cursor in one link, or a selection of exactly that link: the whole link is edited in place. A selection of
    // part of a link, or over several, is acted on as selected (Q251).
    const inside = one !== undefined && (base.from === base.to ? base.from >= one.from && base.to <= one.to : base.from === one.from && base.to === one.to);
    const range = inside ? { from: one.from, to: one.to } : base;
    linkTarget = { from: range.from, to: range.to, links: runs.length };
    linkText.value = inside ? one.text : view.state.doc.textBetween(range.from, range.to, " ");
    linkHref.value = one?.href ?? "";
    setDisabled(linkRemove, runs.length === 0);
    linkError.hidden = opts.refused !== true;
    linkError.textContent = opts.refused === true ? t("linkUnsafe") : "";
    if (el.hidden) {
      el.hidden = false;
      refresh();
    }
    el.classList.add("linking");
    linkPanel.hidden = false;
    place();
    linkHref.focus();
    return true;
  }

  function closeLinkPanel(): void {
    linkPanel.hidden = true;
    linkError.hidden = true;
    linkTarget = null;
    el.classList.remove("linking");
    place();
  }

  /** Cancel, Esc or a click outside: nothing changes, the rows come back and the editor has the focus again. */
  function cancelLinkPanel(): void {
    closeLinkPanel();
    view.focus();
    refresh();
  }

  function applyLinkPanel(): void {
    const target = linkTarget;
    const type = marks["link"];
    if (target === null || type === undefined) return;
    const href = linkHref.value.trim();
    const kind = href === "" ? "empty" : classifyAddress(href);
    if (kind === "refused") {
      linkError.textContent = t("linkRefused");
      linkError.hidden = false;
      linkHref.focus();
      return;
    }
    const { from, to } = target;
    if (kind === "path") {
      // A local path or `file:` link: the existing confirmation and copy, so the link points at Vesta's copy (A5).
      closeLinkPanel();
      view.focus();
      options.onLinkPath?.(href, { from, to });
      refresh();
      return;
    }
    const tr = view.state.tr;
    if (kind === "empty") {
      // An empty address removes the link it was on; on new text it links nothing (spec Edge Cases).
      if (target.links > 0) tr.removeMark(from, to, type);
    } else {
      const original = view.state.doc.textBetween(from, to, " ");
      const typed = linkText.value;
      const words = typed === "" ? href : typed;
      if (from === to || words !== original) {
        // New or changed text takes the marks of the range's first character, or of the cursor, without a link.
        const first = from === to ? (view.state.storedMarks ?? view.state.selection.$from.marks()) : (view.state.doc.nodeAt(from)?.marks ?? []);
        tr.replaceWith(from, to, view.state.schema.text(words, type.removeFromSet(first)));
        tr.addMark(from, from + words.length, type.create({ href }));
      } else {
        tr.removeMark(from, to, type);
        tr.addMark(from, to, type.create({ href }));
      }
    }
    if (tr.docChanged) view.dispatch(tr);
    closeLinkPanel();
    view.focus();
    refresh();
  }

  function place(): void {
    if (el.hidden) return;
    const sel = view.state.selection;
    const host = view.dom.getBoundingClientRect();
    const height = el.offsetHeight;
    const width = el.offsetWidth;
    let top: number;
    let left: number;
    if (!sel.empty) {
      const a = view.coordsAtPos(sel.from);
      const b = view.coordsAtPos(sel.to);
      top = Math.min(a.top, b.top) - height - GAP;
      left = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2 - width / 2;
      if (top < GAP) top = Math.max(a.bottom, b.bottom) + GAP;
    } else {
      top = host.top - height - GAP;
      left = host.left;
      if (top < GAP) top = host.bottom + GAP;
    }
    el.style.top = `${String(Math.round(top))}px`;
    el.style.left = `${String(Math.round(Math.max(GAP, Math.min(window.innerWidth - width - GAP, left))))}px`;
  }

  /** The states every button and the Format menu show (refresh, snapshot; 013 FR-016). */
  function computeStates(): {
    disabled: Set<string>;
    pressed: Map<string, boolean>;
    heading: number;
    tableActions: Set<string>;
    outdentDisabled: boolean;
  } {
    const disabled = new Set<string>();
    const pressed = new Map<string, boolean>();
    const blockPressed = pressedStates(view.state, scope);
    const noInline = inlineUnavailable(view);
    for (const id of buttons.keys()) if (INLINE_OPTIONS.has(id) && noInline) disabled.add(id);
    // 012 FR-008, FR-012: Checklist needs a paragraph or list item; Indent an item with one before it.
    const info = describeRange(view.state, scope);
    if (buttons.has("check") && checklistAction(info.blocks) === "disabled") disabled.add("check");
    // 012 FR-017: each size button is unavailable when every part is at its end.
    const sizes = sizesIn(view.state, scope);
    for (const [id, dir] of [["size-up", 1], ["size-down", -1]] as const) if (buttons.has(id) && (noInline || !canStep(sizes, dir))) disabled.add(id);
    if (buttons.has("indent") && indentAction(info.blocks, 1) === "disabled") disabled.add("indent");
    const outdentDisabled = !buttons.has("indent") || indentAction(info.blocks, -1) === "disabled";
    const tableActions = new Set<string>(applicableActions(view.state));
    const heading = buttons.has("heading") ? headingLevel(view, whole) : 0;
    for (const id of buttons.keys()) {
      const type = marks[id];
      if (id === "mark") pressed.set(id, blockPressed.highlight);
      else if (id === "bullet" || id === "ordered" || id === "quote" || id === "codeblock" || id === "check") pressed.set(id, blockPressed[id]);
      else if (type && id !== "link") pressed.set(id, allHave(view, scope, type));
      else if (id === "link" && marks["link"]) pressed.set(id, allHave(view, scope, marks["link"]));
      else if (id === "underline" && spanType) pressed.set(id, allHave(view, scope, spanType, (a) => a.underline));
      else if (id === "color" && spanType) pressed.set(id, textColorOn());
      else if (id === "heading") pressed.set(id, heading > 0);
    }
    return { disabled, pressed, heading, tableActions, outdentDisabled };
  }

  /** 013 FR-040: the label column is as wide as the widest label the scope can show, so no button moves. */
  function measureLabel(): void {
    const keys: MessageKey[] =
      scope === "details"
        ? ["fmAll_details", "fmSel", ...Object.values(LABEL_KEY)]
        : [scope === "reminder" ? "fmAll_reminder" : "fmAll_title", "fmSel"];
    const probe = scopeLabel.cloneNode() as HTMLElement;
    probe.removeAttribute("id");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.width = "auto";
    el.append(probe);
    let widest = 0;
    for (const key of keys) {
      probe.textContent = t(key);
      widest = Math.max(widest, probe.getBoundingClientRect().width);
    }
    probe.remove();
    if (widest > 0) el.style.setProperty("--fm-label-w", `${String(Math.ceil(widest))}px`);
  }

  function refresh(): void {
    if (el.hidden) return;
    const label = labelOf(view, scope);
    scopeLabel.textContent = t(label === "whole" ? (scope === "reminder" ? "fmAll_reminder" : "fmAll_title") : LABEL_KEY[label]);
    const states = computeStates();
    for (const [id, button] of buttons) {
      if (INLINE_OPTIONS.has(id) || id === "check" || id === "size-up" || id === "size-down" || id === "indent") setDisabled(button, states.disabled.has(id));
    }
    for (const id of TABLE_ACTIONS) {
      const button = buttons.get(id);
      if (button) button.hidden = !states.tableActions.has(id);
    }
    // 018 FR-036: the third row shows while a table option applies; the label spans the rows shown.
    tableRow.hidden = !TABLE_ACTIONS.some((id) => buttons.has(id) && states.tableActions.has(id));
    scopeLabel.style.gridRow = tableRow.hidden ? "1 / span 2" : "1 / span 3";
    // 013 FR-041: the swatches show the color the next press applies.
    const colorGlyph = buttons.get("color")?.querySelector<HTMLElement>("span[data-glyph]");
    // 016 FR-019: Text color shows the last text color picked, which a click applies.
    if (colorGlyph) colorGlyph.style.borderBottomColor = textSwatch(colorsPort);
    const markGlyph = buttons.get("mark")?.querySelector<HTMLElement>("span[data-glyph]");
    if (markGlyph) markGlyph.style.backgroundColor = currentColor(view, "bg", scope) ?? "";
    for (const [id, button] of buttons) {
      const pressed = states.pressed.get(id);
      if (id === "heading") {
        const glyph = button.firstElementChild;
        if (glyph instanceof HTMLElement) glyph.dataset.glyph = states.heading > 0 ? `H${String(states.heading)}` : "H";
      }
      if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
    }
    place();
  }

  function snapshot(): FormatSnapshot {
    const states = computeStates();
    const offered: SnapshotId[] = [];
    for (const id of buttons.keys()) {
      if ((TABLE_ACTIONS as readonly string[]).includes(id)) continue;
      if ((SNAPSHOT_IDS as readonly string[]).includes(id)) offered.push(id as SnapshotId);
      if (id === "indent") offered.push("outdent");
      if (id === "mark") offered.push("bg");
    }
    const disabled = [...states.disabled].filter((id): id is SnapshotId => (SNAPSHOT_IDS as readonly string[]).includes(id));
    if (states.outdentDisabled && offered.includes("outdent")) disabled.push("outdent");
    const pressed = [...states.pressed].flatMap(([id, on]) => (on && (SNAPSHOT_IDS as readonly string[]).includes(id) ? [id as SnapshotId] : []));
    const tableActions = TABLE_ACTIONS.filter((a) => buttons.has(a) && states.tableActions.has(a));
    const level = Math.max(0, Math.min(6, states.heading)) as FormatSnapshot["heading"];
    return { offered, pressed, disabled, heading: level, inTable: tableActions.length > 0, tableActions };
  }

  // Clicks keep the editor's focus and selection.
  el.addEventListener("mousedown", (e) => {
    if (e.target instanceof Element && e.target.closest("button")) e.preventDefault();
  });
  el.addEventListener("click", (e) => {
    const act = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".fm-linkpanel button[data-act]") : null;
    if (act !== null) {
      if (isDisabled(act)) return;
      if (act.dataset.act === "apply") applyLinkPanel();
      else if (act.dataset.act === "cancel") cancelLinkPanel();
      else if (act.dataset.act === "remove" && linkTarget !== null && marks["link"] !== undefined) {
        view.dispatch(view.state.tr.removeMark(linkTarget.from, linkTarget.to, marks["link"]));
        closeLinkPanel();
        view.focus();
        refresh();
      }
      return;
    }
    const button = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-cmd]") : null;
    // The click that ends a long press opened the grid or the picker; it does nothing more (FR-020, FR-042).
    const pressed = presses.find((p) => p.id === button?.dataset.cmd);
    if (pressed?.press.consumeClick() === true) return;
    // 016 FR-020: a click on Text color applies the swatch, or removes it; Format › Text Color… still opens the picker.
    if (button?.dataset.cmd === "color") {
      if (!isDisabled(button)) toggleTextColor();
      return;
    }
    if (button?.dataset.cmd !== undefined) run(button.dataset.cmd, e.shiftKey);
  });
  // A toolbar: one tab stop, arrows move between the options (FR-026).
  el.addEventListener("keydown", (e) => {
    if (e.target instanceof Node && linkPanel.contains(e.target)) {
      // 016 FR-015: Enter in either field applies; Esc cancels and closes the panel only.
      if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
        e.preventDefault();
        applyLinkPanel();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelLinkPanel();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      view.focus();
      return;
    }
    // Shift+Enter on the focused Table button opens the size grid with the focus in it (FR-019).
    if (e.key === "Enter" && e.shiftKey && e.target instanceof HTMLButtonElement && e.target.dataset.cmd === "table") {
      e.preventDefault();
      e.stopPropagation();
      sizeGrid.open(e.target, true);
      return;
    }
    // 016 FR-021: Shift+Enter on the focused Text color button opens the text color picker with the focus in it.
    if (e.key === "Enter" && e.shiftKey && e.target instanceof HTMLButtonElement && e.target.dataset.cmd === "color") {
      e.preventDefault();
      e.stopPropagation();
      picker.open("color", e.target, true);
      return;
    }
    // 013 FR-042: Shift+Enter on the focused Highlight button opens the highlight picker with the focus in it.
    if (e.key === "Enter" && e.shiftKey && e.target instanceof HTMLButtonElement && e.target.dataset.cmd === "mark") {
      e.preventDefault();
      e.stopPropagation();
      picker.open("bg", e.target, true);
      return;
    }
    // 012 FR-007: Shift+Enter on the focused Indent button outdents.
    if (e.key === "Enter" && e.shiftKey && e.target instanceof HTMLButtonElement && e.target.dataset.cmd === "indent") {
      e.preventDefault();
      run("indent", true);
      return;
    }
    // 016 FR-026: Shift+Enter on the focused Quote button nests one level deeper.
    if (e.key === "Enter" && e.shiftKey && e.target instanceof HTMLButtonElement && e.target.dataset.cmd === "quote") {
      e.preventDefault();
      run("quote", true);
      return;
    }
    // Shift+Enter on the focused Code block button merges (FR-002a).
    if (e.key === "Enter" && e.shiftKey && e.target instanceof HTMLButtonElement && e.target.dataset.cmd === "codeblock") {
      e.preventDefault();
      run("codeblock", true);
      return;
    }
    // 013 contracts/ui.md: Up and Down move to the same position in the next or previous row shown (or its last
    // button), wrapping around; 018 FR-036: the table options' row is the third while it shows.
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && document.activeElement instanceof HTMLElement) {
      const inRow = (r: HTMLElement) => Array.from(r.querySelectorAll<HTMLElement>("button[data-cmd]")).filter((b) => !b.hidden);
      const shownRows = rows.filter((r) => !r.hidden && inRow(r).length > 0);
      const rowIndex = shownRows.findIndex((r) => r.contains(document.activeElement));
      if (rowIndex < 0 || shownRows.length < 2) return;
      const here = inRow(shownRows[rowIndex] as HTMLElement);
      const step = e.key === "ArrowDown" ? 1 : shownRows.length - 1;
      const other = inRow(shownRows[(rowIndex + step) % shownRows.length] as HTMLElement);
      if (other.length === 0) return;
      e.preventDefault();
      const target = other[Math.min(here.indexOf(document.activeElement), other.length - 1)] ?? other.at(-1);
      for (const c of controls) c.tabIndex = -1;
      if (target) {
        target.tabIndex = 0;
        target.focus();
      }
      return;
    }
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    const shown = controls.filter((c) => !c.hidden);
    const at = shown.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    e.preventDefault();
    const n = shown.length;
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    for (const c of controls) c.tabIndex = -1;
    const target = shown[next];
    if (target) {
      target.tabIndex = 0;
      target.focus();
    }
  });

  const onScroll = () => {
    place();
  };
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);

  return {
    element: el,
    refresh,
    show() {
      if (!el.hidden) return;
      el.hidden = false;
      measureLabel();
      refresh();
    },
    hide() {
      el.hidden = true;
      closeLinkPanel();
      picker.close(false);
      sizeGrid.close(false);
    },
    ownsEscape: () => picker.isOpen() || sizeGrid.isOpen() || !linkPanel.hidden || el.contains(document.activeElement),
    escape() {
      if (picker.isOpen()) {
        picker.close(true);
        return;
      }
      if (sizeGrid.isOpen()) {
        sizeGrid.close(true);
        return;
      }
      if (!linkPanel.hidden) {
        cancelLinkPanel();
        return;
      }
      view.focus();
    },
    contains: (node) => node !== null && (el.contains(node) || picker.element.contains(node) || sizeGrid.element.contains(node)),
    extraFocusRoots: [picker.element, sizeGrid.element],
    holdsFocus: () => picker.rerendering(),
    run,
    snapshot,
    openLinkPanel,
    openSizeGrid() {
      const button = buttons.get("table");
      if (button === undefined || isDisabled(button)) return false;
      if (el.hidden) {
        el.hidden = false;
        refresh();
      }
      sizeGrid.open(button, true);
      return true;
    },
    relabel() {
      el.setAttribute("aria-label", t("fmLabel"));
      for (const item of labelled) {
        if (item.el instanceof HTMLLabelElement) item.el.title = t(item.key);
        else {
          if (item.title) item.el.title = titleFor(item.el.dataset.cmd ?? "", item.key);
          item.el.setAttribute("aria-label", t(item.key));
        }
      }
      labelLinkPanel();
      picker.relabel();
      sizeGrid.relabel();
      if (!el.hidden) {
        measureLabel();
        refresh();
      }
    },
    destroy() {
      for (const p of presses) p.press.destroy();
      picker.destroy();
      sizeGrid.destroy();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      el.remove();
    },
  };
}

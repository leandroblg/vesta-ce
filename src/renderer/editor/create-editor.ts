// The live editors (FR-013, research §2): one Milkdown setup per scope on one schema family.
//   title, reminder: one heading-or-paragraph block and the inline marks of FR-014's first column;
//   details: CommonMark and GFM, the same marks, code highlighting.
// The stored text stays the source of truth (constitution III): opening and closing without an edit
// returns it unchanged, and only edited blocks are re-serialized in canonical form (FR-015b, FR-016).
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  commonmark,
  createCodeBlockCommand,
  insertHrCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  paragraphAttr,
  headingAttr,
  imageAttr,
  emphasisAttr,
  strongAttr,
  inlineCodeAttr,
  linkAttr,
  emphasisKeymap,
  emphasisSchema,
  emphasisStarInputRule,
  emphasisUnderscoreInputRule,
  headingIdGenerator,
  headingSchema,
  htmlSchema,
  imageSchema,
  inlineCodeInputRule,
  inlineCodeKeymap,
  inlineCodeSchema,
  linkSchema,
  paragraphSchema,
  remarkInlineLinkPlugin,
  remarkMarker,
  remarkPreserveEmptyLinePlugin,
  strongInputRule,
  strongKeymap,
  strongSchema,
  textSchema,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInHeadingInputRule,
  listItemKeymap,
} from "@milkdown/kit/preset/commonmark";
import {
  createTable,
  gfm,
  insertTableCommand,
  remarkGFMPlugin,
  strikethroughAttr,
  strikethroughInputRule,
  strikethroughKeymap,
  strikethroughSchema,
  tableCellSchema,
  tableHeaderSchema,
  toggleStrikethroughCommand,
  wrapInTaskListInputRule,
} from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { prism } from "@milkdown/plugin-prism";
import { $inputRule, $markSchema, $node, $prose, $remark, $view, callCommand, replaceAll } from "@milkdown/kit/utils";
import { keymap } from "@milkdown/kit/prose/keymap";
import type { FormatSnapshot } from "../../domain/menu/state";
import { indentItems, nestQuote, outdentItems, typedChecklist } from "./menu/block-toggles";
import { tableHandlesPlugin } from "./table-handles";
import type { ColorListsPort } from "./menu/color-picker";
import { paintSpan } from "../markdown/paint";
import { createFloatingMenu, type FloatingMenu } from "./menu/floating-menu";
import { sanitizeHtml } from "../markdown/sanitize";
import { mountEmbed } from "../markdown/youtube";
import { t } from "../i18n/t";
import { reportError } from "../report";
import type { AssetRef } from "../../shared/ipc-contract";
import { linkAllowed, youtubeEmbedId } from "../../domain/markdown/policy";
import { redo as historyRedo, undo as historyUndo } from "@milkdown/kit/prose/history";
import { registerEditor } from "./active";
import { isClose } from "../keyboard/registry";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { markRule } from "@milkdown/kit/prose";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { Mark, type Node as ProseNode, type ResolvedPos, type Schema } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, Selection, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isSafeAddress } from "../../domain/markdown/links";
import { actions } from "../store/store";
import { linkInside, linkRuns, type LinkRun } from "./links";
import type { Root } from "mdast";
import { defaultHandlers, type Handle, type Options as StringifyOptions } from "mdast-util-to-markdown";
import { gemoji } from "gemoji";
import { canonicalStringifyOptions, normalizeColor, spans, type SpanAttributes } from "../../domain/markdown/spans";
import { parseMarkdown, walk } from "../../domain/markdown/parse";
import { preserveUnedited, type EditorBlock } from "../../domain/markdown/preserve";
import { isAssetRef } from "../../domain/markdown/assets";
import { flattenToTitleScope } from "../../domain/markdown/title-scope";

export type EditorScope = "title" | "reminder" | "details";

export type EditorOptions = {
  scope: EditorScope;
  /** The stored markdown. */
  value: string;
  /** The document changed; read it with `getMarkdown()`. */
  onChange?: () => void;
  onBlur?: () => void;
  /** Enter (titles and reminders) and Esc (every scope), outside composition; return true when handled. */
  onKey?: (key: "enter" | "escape") => boolean;
  placeholder?: string;
  label?: string;
  /** Maps a stored reference (`assets/…`) to the URL the page loads it from. */
  resolveAsset?: (ref: string) => string;
  /** Opens a link on Cmd/Ctrl+click (FR-031); a plain click places the cursor. */
  openLink?: (href: string) => void;
  /** The tooltip on links: "Cmd+click to open" (FR-031, Clarifications). */
  /** 010 FR-027 (I2): the hint tooltip of each link, from its address (the host, then "Cmd+click to open"). */
  linkTitleFor?: (href: string) => string;
  /** Stores dropped or pasted files (FR-027); the refs come back to be inserted. */
  importFiles?: (files: File[]) => Promise<AssetRef[]>;
  /** The menu's "Insert file or image": the file dialog (FR-027). */
  pickFiles?: () => Promise<AssetRef[]>;
  /** A `file:` URL or absolute path typed as a link (FR-027a). */
  importPath?: (path: string) => Promise<AssetRef | null>;
  /** 011 FR-014: the pinned and recent colors of the picker; in memory when absent. */
  colors?: ColorListsPort;
  /**
   * 016 FR-016c (Q257): once created, select the n-th link whose address is not allowed (in document order, as the
   * read-only text counts its `[data-unsafe-link]` placeholders) and open the link panel on it with the refusal line.
   */
  unsafeLinkAt?: number;
  /** 011 FR-020b: the Rows before columns setting, read when the size grid opens. */
  tableRowsFirst?: () => boolean;
};

export type EditorHandle = {
  getMarkdown(): string;
  /** Replaces the content with stored markdown, as if it had just been loaded (no edit). */
  setMarkdown(md: string): void;
  /** Focuses the editor; `atEnd` puts the caret after the last character. */
  focus(atEnd?: boolean): void;
  /** Inserts text at the selection, as typed. */
  insertText(text: string): void;
  /** New label and placeholder after a language switch, keeping the text and history (007 FR-017). */
  relabel(label: string | undefined, placeholder: string | undefined): void;
  /**
   * Gives the editor its textbox role once it is live and focused. Until then it is not offered as a text
   * field, so nothing (a test's fill) types into a view whose selection is still being set up.
   */
  markReady(): void;
  /** 013 research §4: runs a floating-menu option by id, as the Format menu does. */
  format(id: string, shift?: boolean): boolean;
  /** 013 FR-016: the floating menu's offer, pressed and disabled states. */
  formatSnapshot(): FormatSnapshot | null;
  destroy(): void;
  readonly view: EditorView;
};

// ---------------------------------------------------------------------------
// Marks shared by every scope: [text]{…} and ==text== (FR-015)

const spansRemark = $remark("vestaSpans", () => spans);

function parseOther(value: string | undefined): string[] {
  if (value === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const vestaSpanSchema = $markSchema("vestaSpan", () => ({
  attrs: {
    color: { default: null },
    bg: { default: null },
    size: { default: null },
    underline: { default: false },
    other: { default: [] },
  },
  // Pasted or dragged spans from another Vesta editor.
  parseDOM: [
    {
      tag: "span[data-vesta-span]",
      getAttrs: (dom: HTMLElement) => ({
        // A pasted span cannot keep a short color form (011 FR-015).
        color: dom.dataset.color === undefined ? null : normalizeColor(dom.dataset.color),
        bg: dom.dataset.bg === undefined ? null : normalizeColor(dom.dataset.bg),
        size: dom.dataset.size ?? null,
        underline: dom.dataset.underline === "1",
        other: parseOther(dom.dataset.other),
      }),
    },
  ],
  // Colors and sizes go through the CSSOM: the CSP forbids style attributes (research §1 item 7).
  toDOM: (mark) => {
    const attrs = mark.attrs as SpanAttributes;
    const el = document.createElement("span");
    el.dataset.vestaSpan = "";
    if (attrs.color !== null) el.dataset.color = attrs.color;
    if (attrs.bg !== null) {
      el.dataset.bg = attrs.bg;
      el.classList.add("md-bg");
    }
    if (attrs.size !== null) {
      el.dataset.size = attrs.size;
      el.style.fontSize = attrs.size;
    }
    // 011 FR-009: drawn readable for the active theme; the stored colors stay in the data attributes.
    paintSpan(el);
    if (attrs.underline) {
      el.dataset.underline = "1";
      el.classList.add("md-u");
    }
    if (attrs.other.length > 0) el.dataset.other = JSON.stringify(attrs.other);
    return el;
  },
  parseMarkdown: {
    match: (node) => node.type === "vestaSpan",
    runner: (state, node, type) => {
      state.openMark(type, { ...(node.attributes as SpanAttributes) });
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "vestaSpan",
    runner: (state, mark) => {
      const attributes = mark.attrs as SpanAttributes;
      state.withMark(mark, "vestaSpan", undefined, {
        attributes: {
          ...attributes,
          color: attributes.color === null ? null : normalizeColor(attributes.color),
          bg: attributes.bg === null ? null : normalizeColor(attributes.bg),
          other: [...attributes.other],
        },
      });
    },
  },
}));

const markSchema = $markSchema("mark", () => ({
  parseDOM: [{ tag: "mark" }],
  toDOM: () => ["mark", { class: "md-mark" }, 0],
  parseMarkdown: {
    match: (node) => node.type === "mark",
    runner: (state, node, type) => {
      state.openMark(type);
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "mark",
    runner: (state, mark) => {
      state.withMark(mark, "mark");
    },
  },
}));

/** 016 FR-023, FR-024: `[] `, `[ ] `, `[x] ` or `[X] ` at the start of a paragraph in the details (block-toggles). */
export const checklistInputRule = $inputRule(
  () => new InputRule(/^\[( |x|X)?\]\s$/, (state, match, start, end) => typedChecklist(state, /x/i.test(match[1] ?? ""), start, end)),
);

export const markInputRule = $inputRule((ctx) => markRule(/(?:==)([^=]+)(?:==)$/, markSchema.type(ctx)));

// :name: → the emoji character (FR-020); gemoji is data only, no images.
let emojiByName: Map<string, string> | null = null;
function emojiFor(name: string): string | undefined {
  emojiByName ??= new Map(gemoji.flatMap((g) => g.names.map((n) => [n, g.emoji] as const)));
  return emojiByName.get(name);
}
const emojiInputRule = $inputRule(
  () =>
    new InputRule(/:([a-z0-9_+-]+):$/, (state, match, start, end) => {
      const emoji = match[1] === undefined ? undefined : emojiFor(match[1]);
      return emoji === undefined ? null : state.tr.insertText(emoji, start, end);
    }),
);

// ---------------------------------------------------------------------------
// Title and reminder scope: one block; anything else stays text (FR-014, FR-015b)

const titleDocSchema = $node("doc", () => ({
  content: "(paragraph | heading)",
  parseMarkdown: {
    match: ({ type }) => type === "root",
    runner: (state, node, type) => {
      state.injectRoot(node, type);
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "doc",
    runner: (state, node) => {
      state.openNode("root");
      state.next(node.content);
    },
  },
}));

// unified makes no file value for an empty string.
const sourceText = (value: unknown): string => (typeof value === "string" ? value : "");

/** Out-of-scope syntax in a title becomes its source text, so nothing is lost (FR-015b). */
const titleFlattenRemark = $remark("vestaTitleFlatten", () => () => (tree: Root, file) => {
  flattenToTitleScope(tree, sourceText(file.value));
});

// ---------------------------------------------------------------------------
// Blocks of the stored text, recorded when it is loaded (for preserveUnedited)

type Loaded = { md: string; doc: ProseNode | null; ranges: [number, number][] | null; capturing: boolean };

function recordBlocksRemark(loaded: Loaded) {
  return $remark("vestaRecordBlocks", () => () => (tree: Root, file) => {
    if (!loaded.capturing || sourceText(file.value) !== loaded.md) return;
    const ranges: [number, number][] = [];
    for (const child of tree.children) {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start === undefined || end === undefined) {
        loaded.ranges = null;
        return;
      }
      ranges.push([start, end]);
    }
    loaded.ranges = ranges;
  });
}

/** Pairs of equal top-level nodes (initial index, current index), in order: a longest common subsequence. */
function alignBlocks(before: ProseNode[], after: ProseNode[]): Map<number, number> {
  const pairs = new Map<number, number>();
  let head = 0;
  while (head < before.length && head < after.length && before[head]?.eq(after[head] as ProseNode)) {
    pairs.set(head, head);
    head++;
  }
  let tailA = before.length;
  let tailB = after.length;
  while (tailA > head && tailB > head && before[tailA - 1]?.eq(after[tailB - 1] as ProseNode)) {
    tailA--;
    tailB--;
    pairs.set(tailA, tailB);
  }
  const n = tailA - head;
  const m = tailB - head;
  if (n === 0 || m === 0) return pairs;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] = before[head + i]?.eq(after[head + j] as ProseNode)
        ? (table[i + 1]?.[j + 1] ?? 0) + 1
        : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[head + i]?.eq(after[head + j] as ProseNode)) {
      pairs.set(head + i, head + j);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

const children = (node: ProseNode): ProseNode[] => {
  const list: ProseNode[] = [];
  node.forEach((child) => list.push(child));
  return list;
};

const BLANK = /^\s*$/;

/** Two nodes equal in everything but the `checked` state of their task-list items. */
function sameExceptChecked(a: ProseNode, b: ProseNode): boolean {
  if (a.type !== b.type || a.childCount !== b.childCount || a.text !== b.text) return false;
  if (!a.sameMarkup(b)) {
    if (a.type.name !== "list_item") return false;
    const { checked: _a, ...restA } = a.attrs;
    const { checked: _b, ...restB } = b.attrs;
    if (typeof a.attrs.checked !== typeof b.attrs.checked || JSON.stringify(restA) !== JSON.stringify(restB))
      return false;
    if (!Mark.sameSet(a.marks, b.marks)) return false;
  }
  for (let k = 0; k < a.childCount; k++) if (!sameExceptChecked(a.child(k), b.child(k))) return false;
  return true;
}

const taskStates = (node: ProseNode): boolean[] => {
  const states: boolean[] = [];
  node.descendants((child) => {
    if (child.type.name === "list_item" && typeof child.attrs.checked === "boolean") states.push(child.attrs.checked);
  });
  return states;
};

const BOX = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/;

/** The block's source with the boxes whose state changed flipped; null if the boxes cannot be found. */
function flipBoxes(source: string, old: ProseNode, next: ProseNode): string | null {
  const was = taskStates(old);
  const now = taskStates(next);
  const items: number[] = [];
  walk(parseMarkdown(source), (node) => {
    if (node.type === "listItem" && typeof node.checked === "boolean" && node.position?.start.offset !== undefined) {
      items.push(node.position.start.offset);
    }
  });
  if (items.length !== was.length || was.length !== now.length) return null;
  let out = source;
  for (let k = 0; k < items.length; k++) {
    if (was[k] === now[k]) continue;
    const start = items[k] ?? 0;
    // A list item's position starts at its marker; the box follows it.
    const lineStart = source.lastIndexOf("\n", start) + 1;
    const match = BOX.exec(source.slice(lineStart));
    if (!match) return null;
    const at = lineStart + match[0].length - 2;
    out = out.slice(0, at) + (now[k] === true ? "x" : " ") + out.slice(at + 1);
  }
  return out;
}

function buildBlocks(loaded: Loaded, doc: ProseNode, serializeBlock: (node: ProseNode) => string): EditorBlock[] {
  const { md, ranges } = loaded;
  if (!loaded.doc || !ranges || ranges.length !== loaded.doc.childCount) {
    // No map of the stored blocks (an empty document, or one the editor reshaped): every block is new.
    return children(doc)
      .map((node) => serializeBlock(node))
      .filter((blockMd) => blockMd !== "")
      .map((blockMd) => ({ source: null, md: blockMd }));
  }
  const before = children(loaded.doc);
  const after = children(doc);
  const pairs = alignBlocks(before, after);
  // FR-018: a block whose only change is ticked or unticked checklist boxes keeps its spelling, with only
  // those boxes flipped in its source.
  const ticked = new Map<number, string>();
  let floor = -1;
  after.forEach((node, j) => {
    const paired = [...pairs].find(([, jj]) => jj === j);
    if (paired !== undefined) {
      floor = paired[0];
      return;
    }
    for (let i = floor + 1; i < before.length; i++) {
      const old = before[i];
      if (pairs.has(i) || old === undefined) continue;
      if ([...pairs.keys()].some((k) => k > i && (pairs.get(k) ?? 0) < j)) break;
      const range = ranges[i];
      if (!range || !sameExceptChecked(old, node)) continue;
      const source = flipBoxes(md.slice(range[0], range[1]), old, node);
      if (source === null) continue;
      pairs.set(i, j);
      ticked.set(i, source);
      floor = i;
      break;
    }
  });
  const currentFor = new Map<number, number>();
  for (const [i, j] of pairs) currentFor.set(j, i);

  // Stored text between blocks that the editor does not represent (link definitions): kept as written.
  const gapAfter = (i: number): string | null => {
    const end = ranges[i]?.[1] ?? 0;
    const next = ranges[i + 1]?.[0] ?? md.length;
    const gap = md.slice(end, next);
    return BLANK.test(gap) ? null : gap.trim();
  };

  // Gaps after blocks that were edited or deleted go before the next kept block (or at the end),
  // so they stay after whatever replaced those blocks.
  const extra = new Map<number, string[]>();
  let pendingGaps: string[] = [];
  before.forEach((_node, i) => {
    const j = pairs.get(i);
    if (j !== undefined) {
      if (pendingGaps.length > 0) extra.set(j, pendingGaps);
      pendingGaps = [];
      return;
    }
    const gap = gapAfter(i);
    if (gap !== null) pendingGaps.push(gap);
  });
  if (pendingGaps.length > 0) extra.set(after.length, pendingGaps);
  const kept = (sources: string[] | undefined): EditorBlock[] => (sources ?? []).map((source) => ({ source, md: "" }));

  const out: EditorBlock[] = [];
  const lead = md.slice(0, ranges[0]?.[0] ?? md.length);
  if (!BLANK.test(lead)) out.push({ source: lead.trim(), md: "" });
  after.forEach((node, j) => {
    out.push(...kept(extra.get(j)));
    const i = currentFor.get(j);
    if (i === undefined) {
      const blockMd = serializeBlock(node);
      if (blockMd !== "") out.push({ source: null, md: blockMd });
    } else {
      const [start, end] = ranges[i] as [number, number];
      out.push({ source: ticked.get(i) ?? md.slice(start, end), md: "" });
      const gap = gapAfter(i);
      if (gap !== null) out.push({ source: gap, md: "" });
    }
  });
  out.push(...kept(extra.get(after.length)));
  return out;
}

// Milkdown 7.22.2 drops an image whose markdown has no title (null fails its string check), so the
// image is parsed here; its src is mapped to the URL the page loads stored files from.
type ImageSpec = ReturnType<Parameters<typeof imageSchema.extendSchema>[0]> extends (ctx: never) => infer S ? S : never;
function imageSpec(spec: ImageSpec, resolveAsset: ((ref: string) => string) | undefined): ImageSpec {
  return {
    ...spec,
    parseMarkdown: {
      match: ({ type }) => type === "image",
      runner: (state, node, type) => {
        state.addNode(type, {
          src: typeof node.url === "string" ? node.url : "",
          alt: typeof node.alt === "string" ? node.alt : "",
          title: typeof node.title === "string" ? node.title : "",
        });
      },
    },
    // Pasted or dragged images: a stored file shown through vesta-asset:// keeps its ref, and alt is not a title.
    parseDOM: [
      {
        tag: "img[src]",
        getAttrs: (dom: HTMLElement) => {
          const src = dom.getAttribute("src") ?? "";
          return {
            src: src.startsWith("vesta-asset://") ? src.slice("vesta-asset://".length) : src,
            alt: dom.getAttribute("alt") ?? "",
            title: dom.getAttribute("title") ?? "",
          };
        },
      },
    ],
    toDOM: (node) => {
      const src = String(node.attrs.src);
      return ["img", { ...node.attrs, src: resolveAsset && isAssetRef(src) ? resolveAsset(src) : src }];
    },
  };
}

// Table cells keep their alignment as data, not as a style attribute, which the CSP blocks (research §1 item 7).
type CellSpec =
  ReturnType<Parameters<typeof tableCellSchema.extendSchema>[0]> extends (ctx: never) => infer S ? S : never;
const ALIGN = new Set(["left", "center", "right"]);
function cellSpec(spec: CellSpec, tag: "td" | "th"): CellSpec {
  return {
    ...spec,
    // A new table has no alignment (`| --- |`, FR-015a), not Milkdown's default `left`.
    attrs: { ...spec.attrs, alignment: { default: null } },
    parseDOM: [
      {
        tag,
        getAttrs: (dom: HTMLElement) => {
          const align = dom.dataset.align ?? dom.style.textAlign;
          return {
            colspan: Number(dom.getAttribute("colspan") ?? 1),
            rowspan: Number(dom.getAttribute("rowspan") ?? 1),
            colwidth: null,
            alignment: ALIGN.has(align) ? align : null,
          };
        },
      },
    ],
    toDOM: (node) => {
      const alignment = node.attrs.alignment as string | null;
      const attrs: Record<string, string> = {};
      if (node.attrs.colspan !== 1) attrs.colspan = String(node.attrs.colspan);
      if (node.attrs.rowspan !== 1) attrs.rowspan = String(node.attrs.rowspan);
      if (alignment !== null && ALIGN.has(alignment)) {
        attrs["data-align"] = alignment;
        attrs.class = `md-align-${alignment}`;
      }
      return [tag, attrs, 0];
    },
  };
}

// ---------------------------------------------------------------------------

// Images: stored files load through vesta-asset://, and a missing one shows its name (FR-033); a remote image is
// never loaded, a placeholder with its link shows instead (FR-035a, FR-036).
function imageView(resolveAsset: ((ref: string) => string) | undefined) {
  return $view(imageSchema.node, () => (node) => {
    const dom = document.createElement("span");
    dom.className = "md-image";
    const src = String(node.attrs.src);
    const alt = String(node.attrs.alt);
    const placeholder = (text: string, kind: string) => {
      const span = document.createElement("span");
      span.dataset.mdPlaceholder = kind;
      span.textContent = text;
      return span;
    };
    if (!isAssetRef(src)) {
      dom.append(placeholder(t("remoteImage", { u: src }), "remote-image"));
      return { dom, ignoreMutation: () => true };
    }
    const img = document.createElement("img");
    img.alt = alt;
    img.src = resolveAsset ? resolveAsset(src) : src;
    img.addEventListener("error", () => {
      img.hidden = true;
      dom.append(placeholder(t("fileMissing", { n: alt }), "file-missing"));
      reportError("asset.missing", src);
    });
    dom.append(img);
    return { dom, ignoreMutation: () => true };
  });
}

// FR-034: a lone YouTube URL paragraph in the details shows the player below its editable text.
function lonelyYoutube(node: ProseNode): { id: string; url: string } | null {
  if (node.childCount !== 1) return null;
  const only = node.firstChild;
  if (!only?.isText) return null;
  const url = (only.text ?? "").trim();
  const id = youtubeEmbedId(url);
  return id === null ? null : { id, url };
}
const youtubeView = $view(paragraphSchema.node, () => (node) => {
  const embed = lonelyYoutube(node);
  const p = document.createElement("p");
  if (embed === null)
    return { dom: p, contentDOM: p, update: (next) => next.type === node.type && lonelyYoutube(next) === null };
  const dom = document.createElement("div");
  dom.className = "md-yt";
  const figure = document.createElement("div");
  figure.contentEditable = "false";
  figure.className = "md-yt-embed";
  dom.append(p, figure);
  const stop = mountEmbed(figure, embed.id, embed.url);
  return {
    dom,
    contentDOM: p,
    update: (next) => next.type === node.type && lonelyYoutube(next)?.id === embed.id,
    ignoreMutation: (m) => figure.contains(m.target),
    stopEvent: (e) => e.target instanceof Node && figure.contains(e.target),
    destroy: stop,
  };
});

// Inline HTML in details shows as sanitized HTML (FR-035); a lone opening or closing tag (one half of a
// `<details>` section, say) shows as its source, since it cannot be rendered on its own.
const LONE_TAG = /^<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?>$/i;
const VOID_TAG = /^<(?:br|hr|img|wbr)\b/i;
const htmlView = $view(htmlSchema.node, () => (node) => {
  const dom = document.createElement("span");
  const value = String(node.attrs.value);
  dom.dataset.type = "html";
  dom.dataset.value = value;
  dom.contentEditable = "false";
  const source = value.trim();
  if (LONE_TAG.test(source) && !VOID_TAG.test(source)) {
    dom.dataset.source = "";
    dom.textContent = value;
  } else {
    dom.innerHTML = sanitizeHtml(value);
  }
  return { dom, ignoreMutation: () => true };
});

/** 016 FR-016, FR-016c: set once the floating menu exists (the plugin is built before it). */
type LinkHooks = { refused: ((run: LinkRun) => void) | null };

/** The links whose address the read-only text does not link (sanitize.ts), in document order. */
function unsafeRuns(state: EditorView["state"]): LinkRun[] {
  return linkRuns(state, 0, state.doc.content.size).filter((run) => !linkAllowed(run.href));
}

/** The whole link run at `pos`, from the link mark (the DOM shows a stored file's address rewritten). */
function linkRunAt(view: EditorView, pos: number): LinkRun | null {
  return linkRuns(view.state, pos, pos)[0] ?? null;
}

/**
 * Links open on Cmd/Ctrl+click; ticking a task-list box toggles it (FR-018, FR-031). 016: a right-click on a safe
 * link opens the link context menu (FR-016); a link whose address is not safe gets no menu and, on Cmd/Ctrl+click,
 * opens nothing: its text is selected and the link panel opens on it with the refusal line (FR-016c, Q257).
 */
function clicksPlugin(options: EditorOptions, hooks: LinkHooks) {
  return $prose(
    () =>
      new Plugin({
        key: new PluginKey("vestaClicks"),
        props: {
          handleClick: (view, pos, event) => {
            const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
            if (link === null || !(event.metaKey || event.ctrlKey)) return false;
            event.preventDefault();
            const run = linkRunAt(view, pos);
            if (run !== null && !isSafeAddress(run.href)) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, run.from, run.to)));
              hooks.refused?.(run);
              return true;
            }
            options.openLink?.(link.getAttribute("href") ?? "");
            return true;
          },
          // 012 FR-018: a double click inside highlighted text selects exactly that highlighted run.
          handleDoubleClick: (view, pos) => {
            const run = highlightRunAt(view.state.doc.resolve(pos));
            if (run === null) return false;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, run.from, run.to)));
            return true;
          },
          handleDOMEvents: {
            contextmenu: (view, event) => {
              const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
              if (link === null) return false;
              const at = view.posAtDOM(link, 0);
              const run = linkRunAt(view, at) ?? linkRunAt(view, at + 1);
              if (run === null) return false;
              event.preventDefault();
              if (isSafeAddress(run.href)) {
                actions.openLinkMenu({ x: event.clientX, y: event.clientY, href: run.href, text: run.text, back: view.dom });
              }
              return true;
            },
            mousedown: (view, event) => {
              const li =
                event.target instanceof Element ? event.target.closest<HTMLElement>("li[data-item-type='task']") : null;
              if (li === null) return false;
              const box = li.getBoundingClientRect();
              // The box is drawn left of the text (markdown.css).
              if (event.clientX - box.left > 22 || event.clientY - box.top > 26) return false;
              event.preventDefault();
              const $pos = view.state.doc.resolve(view.posAtDOM(li, 0));
              for (let depth = $pos.depth; depth > 0; depth--) {
                const item = $pos.node(depth);
                if (item.type.name === "list_item" && typeof item.attrs.checked === "boolean") {
                  view.dispatch(
                    view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
                      ...item.attrs,
                      checked: !item.attrs.checked,
                    }),
                  );
                  return true;
                }
              }
              return false;
            },
          },
        },
      }),
  );
}

/** The highlight a text node carries: the default (==text==), a chosen color, or none (012 FR-018). */
function highlightOf(node: ProseNode): string | null {
  if (!node.isText) return null;
  for (const mark of node.marks) {
    if (mark.type.name === "mark") return "default";
    const bg = mark.type.name === "vestaSpan" ? (mark.attrs as SpanAttributes).bg : null;
    if (bg !== null) return `bg:${bg}`;
  }
  return null;
}

/** The continuous run of text with the same highlight around a position, in its textblock, or null. */
function highlightRunAt($pos: ResolvedPos): { from: number; to: number } | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const offsets: number[] = [];
  let at = 0;
  for (let i = 0; i < parent.childCount; i++) {
    offsets.push(at);
    at += parent.child(i).nodeSize;
  }
  const offset = $pos.parentOffset;
  // The character just before the position, as the click lands between two characters; the first at the start.
  let index = offsets.findIndex((o, i) => offset > o && offset <= o + parent.child(i).nodeSize);
  if (index < 0) index = parent.childCount > 0 ? 0 : -1;
  const key = index < 0 ? null : highlightOf(parent.child(index));
  if (key === null) return null;
  let first = index;
  let last = index;
  while (first > 0 && highlightOf(parent.child(first - 1)) === key) first--;
  while (last + 1 < parent.childCount && highlightOf(parent.child(last + 1)) === key) last++;
  const start = $pos.start();
  return { from: start + (offsets[first] ?? 0), to: start + (offsets[last] ?? 0) + parent.child(last).nodeSize };
}

type LinkNode = { url: string; title?: string | null; children: { type: string; value?: string }[] };

const AT_LINE_END = /^(?:[\r\n].*)?$/s;
const BARE_URL_EDGE = /^(?:[\s]|$)/;

/** A link whose text is its own http(s) URL is written bare when it reads back as the same link (FR-034). */
function bareUrl(node: LinkNode, before: string, after: string): string | null {
  const [only] = node.children;
  if (node.children.length !== 1 || only?.type !== "text" || only.value !== node.url) return null;
  if (!/^https?:\/\//.test(node.url) || (node.title ?? "") !== "") return null;
  if (!BARE_URL_EDGE.test(before.slice(-1)) || !BARE_URL_EDGE.test(after.slice(0, 1))) return null;
  const tree = parseMarkdown(node.url);
  const paragraph = tree.children[0];
  if (tree.children.length !== 1 || paragraph?.type !== "paragraph") return null;
  const [link] = paragraph.children;
  return paragraph.children.length === 1 && link?.type === "link" && link.url === node.url ? node.url : null;
}

function stringifyOptions(previous: StringifyOptions): StringifyOptions {
  const handlers = previous.handlers ?? {};
  const defaultLink: Handle = handlers.link ?? defaultHandlers.link;
  const text: Handle = (node: { value: string }, _parent, state, info) => {
    // Milkdown's own text handler skips escaping for text ending in a space; Vesta's syntax characters
    // must still be escaped there (FR-015b). Spaces at the end of a block mean nothing in markdown.
    const value = AT_LINE_END.test(info.after) ? node.value.replace(/[ \t]+$/, "") : node.value;
    return state.safe(value, { ...info, encode: [] });
  };
  const link: Handle = (node: LinkNode, parent, state, info) =>
    bareUrl(node, info.before, info.after) ?? defaultLink(node, parent, state, info);
  return { ...previous, ...canonicalStringifyOptions, handlers: { ...handlers, text, link } };
}

/** Cmd+' on macOS, Ctrl+' elsewhere: one more quote level (011 FR-005). Details only: titles have no quotes. */
const nestQuoteKeymap = $prose(() =>
  keymap({
    "Mod-'": (_state, _dispatch, view) => (view === undefined ? false : nestQuote(view)),
  }),
);

/** 011 FR-021: row and column handles on the table holding the cursor or the pointer (details only). */
const tableHandles = $prose(() => tableHandlesPlugin());

/** The plugins of each scope (exported for the 013 FR-048 input-rule test). */
export function presetFor(scope: EditorScope): MilkdownPlugin[] {
  const shared = [spansRemark, vestaSpanSchema, markSchema, markInputRule, emojiInputRule, history, clipboard].flat();
  if (scope === "details") {
    // Edited blocks are written canonically (no source markers), and empty paragraphs are not stored.
    const dropped: MilkdownPlugin[] = [...remarkMarker, ...remarkPreserveEmptyLinePlugin];
    // 016 FR-023: the typed checklist shortcut replaces gfm's task-list rule, so only one fires.
    return [
      commonmark.filter((p) => !dropped.includes(p)),
      gfm.filter((p) => p !== wrapInTaskListInputRule),
      checklistInputRule,
      prism,
      shared,
      nestQuoteKeymap,
      tableHandles,
    ].flat();
  }
  return [
    titleDocSchema,
    paragraphAttr,
    headingAttr,
    imageAttr,
    emphasisAttr,
    strongAttr,
    inlineCodeAttr,
    linkAttr,
    paragraphSchema,
    headingIdGenerator,
    headingSchema,
    textSchema,
    imageSchema,
    emphasisSchema,
    strongSchema,
    inlineCodeSchema,
    linkSchema,
    strikethroughAttr,
    strikethroughSchema,
    remarkGFMPlugin,
    remarkInlineLinkPlugin,
    titleFlattenRemark,
    emphasisStarInputRule,
    emphasisUnderscoreInputRule,
    inlineCodeInputRule,
    strongInputRule,
    strikethroughInputRule,
    wrapInHeadingInputRule,
    toggleEmphasisCommand,
    toggleStrongCommand,
    toggleInlineCodeCommand,
    toggleLinkCommand,
    toggleStrikethroughCommand,
    emphasisKeymap,
    strongKeymap,
    inlineCodeKeymap,
    strikethroughKeymap,
    shared,
  ].flat();
}

export async function createEditor(host: HTMLElement, options: EditorOptions): Promise<EditorHandle> {
  const { scope } = options;
  const inline = scope !== "details";
  const loaded: Loaded = { md: options.value, doc: null, ranges: null, capturing: true };

  // The floating menu, created once the view exists (FR-023).
  let menu: FloatingMenu | null = null;
  // The localized names, changed in place by relabel() (007 FR-017).
  // `ready`: the textbox role is given only once the editor is live (see markReady).
  const names = { label: options.label, placeholder: options.placeholder, ready: false };
  // Milkdown gives the view role="textbox" as it builds it, and create() goes on awaiting after that. The
  // role waits for markReady(), so nothing types into the editor before its focus and selection are set up:
  // a test that typed in that window had its select-all undone (007 T070). Observer callbacks run as
  // microtasks, before anything outside can see the attribute.
  const roleGuard = new MutationObserver(() => {
    if (names.ready) return;
    for (const el of Array.from(host.querySelectorAll(".ProseMirror[role]"))) el.removeAttribute("role");
  });
  roleGuard.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ["role"] });
  // Stored files go in as images or links with their original names (FR-027); set once the view exists.
  let insertAssets: (refs: readonly AssetRef[], at?: number) => void = () => undefined;
  // Focus leaving both the editor and its menu ends the edit, at once (as 001's text field did). A move into
  // the menu does not count, nor does the window losing focus while the menu has it (a native color picker).
  const leaving = (event: FocusEvent, fromMenu: boolean) => {
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (destroyedRef.value || (next !== null && (host.contains(next) || menu?.contains(next) === true))) return;
    if (menu?.holdsFocus() === true) return;
    if (fromMenu && next === null && !document.hasFocus()) return;
    menu?.hide();
    options.onBlur?.();
  };
  const destroyedRef = { value: false };
  const linkHooks: LinkHooks = { refused: null };

  const changes = $prose(
    () =>
      new Plugin({
        key: new PluginKey("vestaChanges"),
        view: () => ({
          update: (view, previous) => {
            if (!view.state.doc.eq(previous.doc)) options.onChange?.();
            menu?.refresh();
          },
        }),
      }),
  );

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      // 012 FR-009 (PRD Q161): Tab and Shift+Tab move the focus; indenting is the Indent button and the
      // remappable indentItem and outdentItem shortcuts, dispatched by the key registry.
      if (scope === "details")
        ctx.update(listItemKeymap.key, (keys) => ({
          ...keys,
          SinkListItem: { ...keys.SinkListItem, shortcuts: [] },
          LiftListItem: { ...keys.LiftListItem, shortcuts: [] },
        }));
      ctx.set(defaultValueCtx, options.value);
      ctx.update(remarkStringifyOptionsCtx, stringifyOptions);
      ctx.update(imageSchema.key, (previous) => (c) => imageSpec(previous(c), options.resolveAsset));
      ctx.update(linkSchema.key, (previous) => (c) => {
        const spec = previous(c);
        return {
          ...spec,
          // The hint tooltip is not a link title; a stored file shown through vesta-asset:// keeps its ref.
          parseDOM: [
            {
              tag: "a[href]",
              getAttrs: (dom: HTMLElement) => {
                const href = dom.getAttribute("href") ?? "";
                const title = dom.getAttribute("title");
                return {
                  href: href.startsWith("vesta-asset://") ? href.slice("vesta-asset://".length) : href,
                  title: title === null || title === options.linkTitleFor?.(href) ? null : title,
                };
              },
            },
          ],
          toDOM: (mark, inline) => {
            const out = spec.toDOM?.(mark, inline);
            if (!Array.isArray(out)) return out ?? ["a", 0];
            const [tag, attrs, ...rest] = out as [string, Record<string, string>, ...unknown[]];
            const href = attrs.href ?? "";
            const shown = options.resolveAsset !== undefined && isAssetRef(href) ? options.resolveAsset(href) : href;
            return [
              tag,
              { ...attrs, href: shown, ...(options.linkTitleFor === undefined ? {} : { title: options.linkTitleFor(href) }) },
              ...rest,
            ] as never;
          },
        };
      });
      if (scope === "details") {
        ctx.update(tableCellSchema.key, (previous) => (c) => cellSpec(previous(c), "td"));
        ctx.update(tableHeaderSchema.key, (previous) => (c) => cellSpec(previous(c), "th"));
      }
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        // A function, so relabel() changes what every later view update writes (007 research §4).
        attributes: () => ({
          ...(names.ready ? { role: "textbox" } : {}),
          spellcheck: "true",
          "aria-multiline": String(!inline),
          ...(names.label === undefined ? {} : { "aria-label": names.label }),
          ...(names.placeholder === undefined ? {} : { "data-placeholder": names.placeholder }),
        }),
        handleKeyDown: (_view, event) => {
          if (event.isComposing) return false;
          // FR-026: an open link prompt takes Esc first.
          if (event.key === "Escape" && menu?.ownsEscape() === true) {
            menu.escape();
            return true;
          }
          // The Close action (Esc unless remapped, 007 FR-032) belongs to the owner in every scope: it closes
          // the panel or the inline editor. Esc never reaches ProseMirror's base keymap, which would select
          // the parent node.
          if (isClose(event)) return options.onKey?.("escape") ?? false;
          if (event.key === "Escape") return true;
          if (!inline) return false;
          if (event.key === "Enter") {
            event.preventDefault();
            options.onKey?.("enter");
            return true;
          }
          return false;
        },
        handleDOMEvents: {
          focus: () => {
            menu?.show();
            return false;
          },
          blur: (_view, event) => {
            leaving(event, false);
            return false;
          },
          // A title is one line: a line break typed or inserted becomes a space (001 FR-019).
          beforeinput: (view, event) => {
            if (!inline || view.composing) return false;
            if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
              event.preventDefault();
              view.dispatch(view.state.tr.insertText(" "));
              return true;
            }
            const data = event.data ?? "";
            if (event.inputType !== "insertText" || !/[\r\n]/.test(data)) return false;
            event.preventDefault();
            view.dispatch(view.state.tr.insertText(data.replace(/\s*[\r\n]+\s*/g, " ")));
            return true;
          },
        },
        handleTextInput: (view, from, to, text) => {
          if (!inline || !/[\r\n]/.test(text)) return false;
          view.dispatch(view.state.tr.insertText(text.replace(/\s*[\r\n]+\s*/g, " "), from, to));
          return true;
        },
        // Plain text pasted into a title keeps its words on one line; rich text goes to the clipboard plugin.
        // FR-035, T060: pasted HTML goes through the same sanitizer as every rendering before it is parsed.
        transformPastedHTML: (html: string) => sanitizeHtml(html),
        handleDrop: (view, event) => {
          const dropped = Array.from(event.dataTransfer?.files ?? []);
          if (dropped.length === 0 || options.importFiles === undefined) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
          void options.importFiles(dropped).then((refs) => {
            insertAssets(refs, at);
          });
          return true;
        },
        handlePaste: (view, event) => {
          const data = event.clipboardData;
          const pasted = Array.from(data?.files ?? []);
          if (pasted.length > 0 && options.importFiles !== undefined) {
            void options.importFiles(pasted).then((refs) => {
              insertAssets(refs);
            });
            return true;
          }
          if (!inline || data === null || data.getData("text/html") !== "" || data.files.length > 0) return false;
          const text = data.getData("text/plain");
          if (!/[\r\n]/.test(text)) return false;
          view.dispatch(view.state.tr.insertText(text.replace(/\s*[\r\n]+\s*/g, " ").trim()));
          return true;
        },
      }));
    })
    .use(presetFor(scope))
    .use(
      scope === "details"
        ? [htmlView, youtubeView, imageView(options.resolveAsset), clicksPlugin(options, linkHooks)]
        : [imageView(options.resolveAsset), clicksPlugin(options, linkHooks)],
    )
    .use(recordBlocksRemark(loaded))
    .use(changes)
    .create();

  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  if (!names.ready) view.dom.removeAttribute("role");
  const COMMANDS = {
    bullet: () => callCommand(wrapInBulletListCommand.key),
    ordered: () => callCommand(wrapInOrderedListCommand.key),
    quote: () => callCommand(wrapInBlockquoteCommand.key),
    codeblock: () => callCommand(createCodeBlockCommand.key),
    hr: () => callCommand(insertHrCommand.key),
    table: () => callCommand(insertTableCommand.key, { row: 3, col: 3 }),
  } as const;
  const floating = createFloatingMenu(view, {
    scope,
    ...(options.colors === undefined ? {} : { colors: options.colors }),
    ...(options.tableRowsFirst === undefined ? {} : { tableRowsFirst: options.tableRowsFirst }),
    // 011 FR-018, FR-020: after the top-level block the selection ends in, in one transaction (one Undo step).
    insertTable: (cols, rows) => {
      editor.action((ctx) => {
        const v = ctx.get(editorViewCtx);
        const $end = v.state.doc.resolve(v.state.selection.to);
        const at = $end.depth > 0 ? $end.after(1) : v.state.doc.content.size;
        const tr = v.state.tr.insert(at, createTable(ctx, rows, cols));
        v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(at + 1))).scrollIntoView());
      });
    },
    runCommand: (command) => {
      editor.action(COMMANDS[command]());
    },
    ...(options.pickFiles === undefined
      ? {}
      : {
          onInsert: () => {
            void options.pickFiles?.().then((refs) => {
              insertAssets(refs);
            });
          },
        }),
    ...(options.importPath === undefined
      ? {}
      : {
          onLinkPath: (path: string, range: { from: number; to: number }) => {
            void options.importPath?.(path).then((ref) => {
              if (ref === null || destroyedRef.value) return;
              const linkType = view.state.schema.marks["link"];
              if (range.from < range.to && linkType) {
                view.dispatch(view.state.tr.addMark(range.from, range.to, linkType.create({ href: ref.ref })));
              } else {
                insertAssets([{ ...ref, isImage: false }], range.from);
              }
            });
          },
        }),
  });
  insertAssets = (refs, at) => {
    if (destroyedRef.value || refs.length === 0) return;
    const { schema } = view.state;
    let tr = view.state.tr;
    if (at !== undefined) tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))));
    const image = schema.nodes["image"];
    const link = schema.marks["link"];
    for (const ref of refs) {
      const node =
        ref.isImage && image
          ? image.create({ src: ref.ref, alt: ref.name, title: "" })
          : schema.text(ref.name, link ? [link.create({ href: ref.ref })] : []);
      tr = tr.replaceSelectionWith(node, false);
    }
    view.dispatch(tr.scrollIntoView());
    view.focus();
  };
  menu = floating;
  linkHooks.refused = () => {
    floating.openLinkPanel({ refused: true });
  };
  // Inside the host (React never manages its children), right after the editor in the tab order.
  host.append(floating.element);
  for (const root of [floating.element, ...floating.extraFocusRoots]) {
    root.addEventListener("focusout", (event) => {
      leaving(event, true);
    });
  }
  if (view.hasFocus()) floating.show();
  if (options.unsafeLinkAt !== undefined) {
    const run = unsafeRuns(view.state)[options.unsafeLinkAt];
    if (run !== undefined) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, run.from, run.to)));
      floating.openLinkPanel({ refused: true });
    }
  }
  loaded.doc = view.state.doc;
  loaded.capturing = false;
  const serialize = editor.action((ctx) => ctx.get(serializerCtx));
  const schema: Schema = view.state.schema;
  const trimEnd = (md: string): string => md.replace(/\n+$/, "");
  const serializeBlock = (node: ProseNode): string => trimEnd(serialize(schema.topNodeType.create(null, node)));

  let destroyed = false;
  // 013 research §4: the Format menu runs the floating menu's own options (Insert Table… opens the size grid).
  const runFormat = (id: string, shift?: boolean): boolean => (id === "table" ? floating.openSizeGrid() : floating.run(id, shift));
  const unregister = registerEditor({
    scope,
    hasFocus: () => !destroyed && view.hasFocus(),
    contains: (node) => view.dom.contains(node),
    menuContains: (node) => floating.contains(node),
    indent: (dir) => (dir === 1 ? indentItems(view, scope) : outdentItems(view, scope)),
    undo: () => historyUndo(view.state, view.dispatch),
    redo: () => historyRedo(view.state, view.dispatch),
    format: (id, shift) => runFormat(id, shift),
    formatSnapshot: () => floating.snapshot(),
    linkAddress: () => linkInside(view.state)?.href ?? null,
  });
  return {
    view,
    format: (id, shift) => runFormat(id, shift),
    formatSnapshot: () => floating.snapshot(),
    setMarkdown(md: string) {
      if (destroyed) return;
      loaded.md = md;
      loaded.capturing = true;
      editor.action(replaceAll(md));
      loaded.capturing = false;
      loaded.doc = view.state.doc;
    },
    getMarkdown() {
      const doc = view.state.doc;
      if (loaded.doc && doc.eq(loaded.doc)) return loaded.md;
      return preserveUnedited(loaded.md, buildBlocks(loaded, doc, serializeBlock));
    },
    insertText(text: string) {
      if (!destroyed) view.dispatch(view.state.tr.insertText(text));
    },
    focus(atEnd = false) {
      if (destroyed) return;
      // A selection someone already made inside the editor (a select-all) is kept: moving the caret to the
      // end would make the next typing append instead of replace.
      const domSelection = view.dom.ownerDocument.getSelection();
      const kept = domSelection !== null && !domSelection.isCollapsed && view.dom.contains(domSelection.anchorNode);
      view.focus();
      if (atEnd && !kept) {
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
      }
    },
    relabel(label: string | undefined, placeholder: string | undefined) {
      if (destroyed) return;
      names.label = label;
      names.placeholder = placeholder;
      for (const [attr, value] of [
        ["aria-label", label],
        ["data-placeholder", placeholder],
      ] as const) {
        if (value === undefined) view.dom.removeAttribute(attr);
        else view.dom.setAttribute(attr, value);
      }
      floating.relabel();
    },
    markReady() {
      if (destroyed || names.ready) return;
      names.ready = true;
      roleGuard.disconnect();
      view.dom.setAttribute("role", "textbox");
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      destroyedRef.value = true;
      roleGuard.disconnect();
      unregister();
      floating.destroy();
      void editor.destroy();
    },
  };
}

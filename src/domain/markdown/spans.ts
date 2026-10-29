// Vesta's custom inline syntax (PRD B3, FR-015, FR-015b), shared by the editor and the read-only renderer:
//   [text]{color="#dd3333" bg="#ffe066" size="1.5em" .underline}   a bracketed span
//   ==text==                                                     a mark (default highlight)
// One remark plugin: a micromark syntax extension, the mdast nodes, and the canonical writer.
import type { Parent, PhrasingContent } from "mdast";
import type { CompileContext, Extension as FromMarkdownExtension, Token as MdastToken } from "mdast-util-from-markdown";
import type {
  ConstructName,
  Handle as ToMarkdownHandle,
  Options as ToMarkdownExtension,
  Options as StringifyOptions,
} from "mdast-util-to-markdown";
import type { Code, Construct, Effects, Event, Extension, State, Token, TokenizeContext } from "micromark-util-types";
import { classifyCharacter } from "micromark-util-classify-character";
import { resolveAll } from "micromark-util-resolve-all";
import { splice } from "micromark-util-chunked";
import type { Processor } from "unified";
// The `Data` fields remark reads its extensions from.
import type {} from "remark-parse";
import type {} from "remark-stringify";

export type SpanAttributes = {
  /** 8-digit lowercase hex (`#rrggbbaa`), or null (011 FR-015). */
  color: string | null;
  /** 8-digit lowercase hex (`#rrggbbaa`), or null (011 FR-015). */
  bg: string | null;
  size: string | null;
  underline: boolean;
  /** Unknown attributes and classes, as written, in their order (no visual effect). */
  other: string[];
};

export interface VestaSpan extends Parent {
  type: "vestaSpan";
  attributes: SpanAttributes;
  children: PhrasingContent[];
}

export interface Mark extends Parent {
  type: "mark";
  children: PhrasingContent[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    vestaSpan: VestaSpan;
    mark: Mark;
  }
  interface RootContentMap {
    vestaSpan: VestaSpan;
    mark: Mark;
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    vestaSpan: "vestaSpan";
    vestaSpanStart: "vestaSpanStart";
    vestaSpanStartMarker: "vestaSpanStartMarker";
    vestaSpanText: "vestaSpanText";
    vestaSpanEnd: "vestaSpanEnd";
    vestaSpanEndMarker: "vestaSpanEndMarker";
    vestaSpanAttributes: "vestaSpanAttributes";
    mark: "mark";
    markSequence: "markSequence";
    markSequenceTemporary: "markSequenceTemporary";
    markText: "markText";
  }
}

declare module "mdast-util-to-markdown" {
  interface ConstructNameMap {
    vestaSpan: "vestaSpan";
    mark: "mark";
  }
}

// ---------------------------------------------------------------------------
// Attributes

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SIZE = /^(\d+(?:\.\d+)?)(em|rem|px|%)$/;
const SIZE_RANGE: Record<string, [number, number]> = { em: [0.5, 4], rem: [0.5, 4], px: [8, 64], "%": [50, 400] };

/** A font size the editor may apply: em, rem, px or %, within readable bounds. */
export function isValidSize(value: string): boolean {
  const match = SIZE.exec(value);
  const range = match?.[2] === undefined ? undefined : SIZE_RANGE[match[2]];
  if (!match || !range) return false;
  const n = Number(match[1]);
  return n >= range[0] && n <= range[1];
}
const ATTRIBUTE = /[ \t]*(?:([.#])([A-Za-z0-9_-]+)|([A-Za-z_][A-Za-z0-9_-]*)=("[^"\r\n]*"|[^\s"'=<>`{}]+))/y;

/**
 * The stored form of a color: 8 lowercase hex digits, `#rrggbbaa` (011 FR-015). `#d33` → `#dd3333ff`,
 * `#d33a` → `#dd3333aa`, `#ffe066` → `#ffe066ff`; an 8-digit color keeps its alpha. Null when not a hex color.
 */
export function normalizeColor(value: string): string | null {
  if (!HEX_COLOR.test(value)) return null;
  let hex = value.slice(1).toLowerCase();
  if (hex.length <= 4) hex = hex.replace(/./g, "$&$&");
  return hex.length === 6 ? `#${hex}ff` : `#${hex}`;
}

export function emptyAttributes(): SpanAttributes {
  return { color: null, bg: null, size: null, underline: false, other: [] };
}

/** Reads `{…}` (braces included) as written in the source. */
export function parseAttributes(raw: string): SpanAttributes {
  const attrs = emptyAttributes();
  const body = raw.slice(1, -1);
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (ATTRIBUTE.lastIndex < body.length && (match = ATTRIBUTE.exec(body)) !== null) {
    const written = match[0].trim();
    const [, sigil, name, key, rawValue] = match;
    if (sigil === "." && name === "underline" && !attrs.underline) {
      attrs.underline = true;
      continue;
    }
    if (key !== undefined && rawValue !== undefined) {
      const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;
      if ((key === "color" || key === "bg") && attrs[key] === null) {
        const color = normalizeColor(value);
        if (color !== null) {
          attrs[key] = color;
          continue;
        }
      } else if (key === "size" && attrs.size === null && isValidSize(value)) {
        attrs.size = value;
        continue;
      }
    }
    attrs.other.push(written);
  }
  return attrs;
}

/** The canonical attribute list: color, bg, size, then classes, then unknown ones as written (FR-015b). */
export function writeAttributes(attrs: SpanAttributes): string {
  const parts: string[] = [];
  if (attrs.color !== null) parts.push(`color="${attrs.color}"`);
  if (attrs.bg !== null) parts.push(`bg="${attrs.bg}"`);
  if (attrs.size !== null) parts.push(`size="${attrs.size}"`);
  if (attrs.underline) parts.push(".underline");
  parts.push(...attrs.other);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Syntax (micromark)

const C = {
  tab: -2,
  virtualSpace: -1,
  space: 32,
  quote: 34,
  hash: 35,
  dash: 45,
  dot: 46,
  equals: 61,
  rightBracket: 93,
  underscore: 95,
  leftBrace: 123,
  rightBrace: 125,
} as const;

const isSpace = (code: Code): boolean => code === C.space || code === C.tab || code === C.virtualSpace;
const isAlpha = (code: Code): boolean => code !== null && ((code >= 65 && code <= 90) || (code >= 97 && code <= 122));
const isDigit = (code: Code): boolean => code !== null && code >= 48 && code <= 57;
const isNameStart = (code: Code): boolean => isAlpha(code) || code === C.underscore;
const isName = (code: Code): boolean => isNameStart(code) || isDigit(code) || code === C.dash;
// Bare values: printable ASCII and beyond, without whitespace, quotes, `=`, `<`, `>`, `` ` ``, braces.
const isBare = (code: Code): boolean =>
  code !== null && code > 32 && code !== 127 && ![34, 39, 61, 60, 62, 96, 123, 125].includes(code);

/** The label start each span end closes, kept for the resolver. */
const spanOpenings = new WeakMap<Token, Token>();

const spanEnd: Construct = {
  name: "vestaSpanEnd",
  add: "before",
  tokenize: tokenizeSpanEnd,
  resolveTo: resolveToSpanEnd,
};

function tokenizeSpanEnd(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const starts = this._labelStarts;
  let opening: Token | undefined;
  if (starts) {
    let index = starts.length;
    while (index > 0 && starts[index - 1]?._balanced) index--;
    opening = starts[index - 1];
  }
  let count = 0;
  let needSpace = false;

  return start;

  function start(code: Code): State | undefined {
    if (opening?.type !== "labelLink") return nok(code);
    effects.enter("vestaSpanEnd");
    effects.enter("vestaSpanEndMarker");
    effects.consume(code);
    effects.exit("vestaSpanEndMarker");
    return open;
  }

  function open(code: Code): State | undefined {
    if (code !== C.leftBrace) return nok(code);
    effects.enter("vestaSpanAttributes");
    effects.consume(code);
    return between;
  }

  function between(code: Code): State | undefined {
    if (isSpace(code)) {
      effects.consume(code);
      needSpace = false;
      return between;
    }
    if (code === C.rightBrace) {
      if (count === 0) return nok(code);
      effects.consume(code);
      effects.exit("vestaSpanAttributes");
      const end = effects.exit("vestaSpanEnd");
      if (opening) spanOpenings.set(end, opening);
      // The label start is used up, as a link's would be.
      starts?.splice(starts.lastIndexOf(opening as Token), 1);
      return ok;
    }
    if (needSpace) return nok(code);
    if (code === C.dot || code === C.hash) {
      effects.consume(code);
      return classStart;
    }
    if (isNameStart(code)) {
      effects.consume(code);
      return key;
    }
    return nok(code);
  }

  function done(code: Code): State | undefined {
    count++;
    needSpace = true;
    return between(code);
  }

  function classStart(code: Code): State | undefined {
    if (!isName(code)) return nok(code);
    effects.consume(code);
    return className;
  }

  function className(code: Code): State | undefined {
    if (isName(code)) {
      effects.consume(code);
      return className;
    }
    return done(code);
  }

  function key(code: Code): State | undefined {
    if (isName(code)) {
      effects.consume(code);
      return key;
    }
    if (code !== C.equals) return nok(code);
    effects.consume(code);
    return valueStart;
  }

  function valueStart(code: Code): State | undefined {
    if (code === C.quote) {
      effects.consume(code);
      return quoted;
    }
    if (isBare(code)) {
      effects.consume(code);
      return bare;
    }
    return nok(code);
  }

  function quoted(code: Code): State | undefined {
    if (code === null || code < 0 || code === 10 || code === 13) {
      if (code === C.tab || code === C.virtualSpace) {
        effects.consume(code);
        return quoted;
      }
      return nok(code);
    }
    effects.consume(code);
    return code === C.quote ? done : quoted;
  }

  function bare(code: Code): State | undefined {
    if (isBare(code)) {
      effects.consume(code);
      return bare;
    }
    return done(code);
  }
}

function resolveToSpanEnd(events: Event[], context: TokenizeContext): Event[] {
  const last = events[events.length - 1];
  const opening = last ? spanOpenings.get(last[1]) : undefined;
  let open = events.length;
  while (open-- > 0) {
    const event = events[open];
    if (event?.[0] === "enter" && event[1] === opening) break;
  }
  let close = events.length;
  while (close-- > 0) {
    const event = events[close];
    if (event?.[0] === "enter" && event[1].type === "vestaSpanEnd") break;
  }
  const openEvent = events[open];
  const marker = events[open + 1];
  const closeEvent = events[close];
  if (!opening || !openEvent || !marker || !closeEvent || !last) return events;

  opening.type = "vestaSpanStart";
  marker[1].type = "vestaSpanStartMarker";

  const group: Token = {
    type: "vestaSpan",
    start: { ...opening.start },
    end: { ...last[1].end },
  };
  const text: Token = {
    type: "vestaSpanText",
    start: { ...opening.end },
    end: { ...closeEvent[1].start },
  };
  const inside = resolveAll(context.parser.constructs.insideSpan.null ?? [], events.slice(open + 4, close), context);

  const media: Event[] = [
    ["enter", group, context],
    ...events.slice(open, open + 4),
    ["enter", text, context],
    ...inside,
    ["exit", text, context],
    ...events.slice(close),
    ["exit", group, context],
  ];
  splice(events, open, events.length - open, media);
  return events;
}

const markConstruct: Construct = {
  name: "mark",
  tokenize: tokenizeMark,
  resolveAll: resolveAllMark,
};

function tokenizeMark(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
  const previous = this.previous;
  const events = this.events;
  let size = 0;

  return start;

  function start(code: Code): State | undefined {
    if (previous === C.equals && events[events.length - 1]?.[1].type !== "characterEscape") return nok(code);
    effects.enter("markSequenceTemporary");
    return more(code);
  }

  function more(code: Code): State | undefined {
    const before = classifyCharacter(previous);
    if (code === C.equals) {
      if (size > 1) return nok(code);
      effects.consume(code);
      size++;
      return more;
    }
    if (size < 2) return nok(code);
    const token = effects.exit("markSequenceTemporary");
    const after = classifyCharacter(code);
    token._open = !after || (after === 2 && Boolean(before));
    token._close = !before || (before === 2 && Boolean(after));
    return ok(code);
  }
}

function resolveAllMark(events: Event[], context: TokenizeContext): Event[] {
  let index = -1;
  while (++index < events.length) {
    const closer = events[index];
    if (closer?.[0] !== "enter" || closer[1].type !== "markSequenceTemporary" || !closer[1]._close) continue;
    let open = index;
    while (open-- > 0) {
      const opener = events[open];
      if (opener?.[0] !== "exit" || opener[1].type !== "markSequenceTemporary" || !opener[1]._open) continue;
      closer[1].type = "markSequence";
      opener[1].type = "markSequence";
      const mark: Token = {
        type: "mark",
        start: { ...opener[1].start },
        end: { ...closer[1].end },
      };
      const text: Token = {
        type: "markText",
        start: { ...opener[1].end },
        end: { ...closer[1].start },
      };
      const next: Event[] = [
        ["enter", mark, context],
        ["enter", opener[1], context],
        ["exit", opener[1], context],
        ["enter", text, context],
        ...resolveAll(context.parser.constructs.insideSpan.null ?? [], events.slice(open + 1, index), context),
        ["exit", text, context],
        ["enter", closer[1], context],
        ["exit", closer[1], context],
        ["exit", mark, context],
      ];
      splice(events, open - 1, index - open + 3, next);
      index = open + next.length - 2;
      break;
    }
  }
  for (const event of events) {
    if (event[1].type === "markSequenceTemporary") event[1].type = "data";
  }
  return events;
}

/** The micromark extension: spans and marks. */
export function spansSyntax(): Extension {
  return {
    text: { [C.rightBracket]: spanEnd, [C.equals]: markConstruct },
    insideSpan: { null: [markConstruct] },
    attentionMarkers: { null: [C.equals] },
  };
}

// ---------------------------------------------------------------------------
// mdast

export function spansFromMarkdown(): FromMarkdownExtension {
  return {
    canContainEols: ["vestaSpan", "mark"],
    enter: {
      vestaSpan(this: CompileContext, token: MdastToken) {
        this.enter({ type: "vestaSpan", attributes: emptyAttributes(), children: [] }, token);
      },
      mark(this: CompileContext, token: MdastToken) {
        this.enter({ type: "mark", children: [] }, token);
      },
    },
    exit: {
      vestaSpanAttributes(this: CompileContext, token: MdastToken) {
        const node = this.stack[this.stack.length - 1];
        if (node?.type === "vestaSpan") node.attributes = parseAttributes(this.sliceSerialize(token));
      },
      vestaSpan(this: CompileContext, token: MdastToken) {
        this.exit(token);
      },
      mark(this: CompileContext, token: MdastToken) {
        this.exit(token);
      },
    },
  };
}

// Constructs inside which `{`, `}` and `==` cannot start syntax, as mdast-util-to-markdown's own list.
const fullPhrasingSpans: ConstructName[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];

function handleSpan(
  node: VestaSpan,
  _parent: Parameters<ToMarkdownHandle>[1],
  state: Parameters<ToMarkdownHandle>[2],
  info: Parameters<ToMarkdownHandle>[3],
): string {
  const tracker = state.createTracker(info);
  const attributes = writeAttributes(node.attributes);
  if (attributes === "") return state.containerPhrasing(node, info);
  const exit = state.enter("vestaSpan");
  const exitLabel = state.enter("label");
  let value = tracker.move("[");
  value += tracker.move(
    state.containerPhrasing(node, {
      ...tracker.current(),
      before: value,
      after: "]",
    }),
  );
  value += tracker.move(`]{${attributes}}`);
  exitLabel();
  exit();
  return value;
}
handleSpan.peek = () => "[";

function handleMark(
  node: Mark,
  _parent: Parameters<ToMarkdownHandle>[1],
  state: Parameters<ToMarkdownHandle>[2],
  info: Parameters<ToMarkdownHandle>[3],
): string {
  const tracker = state.createTracker(info);
  const exit = state.enter("mark");
  let value = tracker.move("==");
  value += tracker.move(
    state.containerPhrasing(node, {
      ...tracker.current(),
      before: value,
      after: "=",
    }),
  );
  value += tracker.move("==");
  exit();
  return value;
}
handleMark.peek = () => "=";

export function spansToMarkdown(): ToMarkdownExtension {
  return {
    handlers: { vestaSpan: handleSpan, mark: handleMark },
    unsafe: [
      {
        character: "{",
        inConstruct: "phrasing",
        notInConstruct: fullPhrasingSpans,
      },
      {
        character: "}",
        inConstruct: "phrasing",
        notInConstruct: fullPhrasingSpans,
      },
      {
        character: "=",
        after: "=",
        inConstruct: "phrasing",
        notInConstruct: fullPhrasingSpans,
      },
    ],
  };
}

/** The remark plugin: `unified().use(remarkParse).use(spans)`. */
export function spans(this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(spansSyntax());
  (data.fromMarkdownExtensions ??= []).push(spansFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(spansToMarkdown());
}

/** The canonical spellings of FR-015a, for every serializer of stored markdown. */
export const canonicalStringifyOptions: StringifyOptions = {
  bullet: "-",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  rule: "-",
  listItemIndent: "one",
  incrementListMarker: true,
  setext: false,
  closeAtx: false,
};

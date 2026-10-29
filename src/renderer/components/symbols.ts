/**
 * The floating editing menu's outline symbols (013 FR-041, research §14; identity §8): one path set per option on the
 * 24-unit grid, drawn at the text weight, never an emoji, no two alike. The menu is plain DOM, so `svgSymbol` builds
 * the element; B, I, U, S, H and the two A buttons stay styled letters.
 */
export const SYMBOLS = {
  code: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14",
  "size-up": "M3 19l5-12 5 12M4.8 15h6.4M18 16V8M15 11l3-3 3 3",
  "size-down": "M3 19l5-12 5 12M4.8 15h6.4M18 8v8M15 13l3 3 3-3",
  "list.bullet": "M9 6h12M9 12h12M9 18h12M4 5.5v1M4 11.5v1M4 17.5v1",
  "list.number": "M10 6h11M10 12h11M10 18h11M4 4v4M3 8h2M3 14.5c0-1.3 2-1.3 2 0 0 1-2 1.6-2 3h2",
  checklist: "M10 6h11M10 12h11M10 18h11M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3.5 16.5h3v3h-3z",
  "increase.indent": "M3 5h18M11 10h10M11 14h10M3 19h18M3 9l3 3-3 3",
  quote: "M7 10c-2 0-3 1.5-3 3.5S5.5 17 7 17s3-1.5 3-3.5c0-3-1-5-4-6.5M17 10c-2 0-3 1.5-3 3.5S15.5 17 17 17s3-1.5 3-3.5c0-3-1-5-4-6.5",
  curlybraces:
    "M8 4c-2 0-2 1.5-2 3v2c0 1.5-1 2.5-2 3 1 .5 2 1.5 2 3v2c0 1.5 0 3 2 3M16 4c2 0 2 1.5 2 3v2c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3v2c0 1.5 0 3-2 3",
  // 016 FR-027 (PRD Q235): left-aligned text lines of unequal length around a full-width rule, never centered text.
  divider: "M3 4h14M3 8h9M3 12h18M3 16h12M3 20h7",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14M15 5v14",
  "row-above": "M4 11h16v8H4zM4 15h16M12 3v6M9 6h6",
  "row-below": "M4 5h16v8H4zM4 9h16M12 15v6M9 18h6",
  "col-left": "M11 4h8v16h-8zM15 4v16M3 12h6M6 9v6",
  "col-right": "M5 4h8v16H5zM9 4v16M15 12h6M18 9v6",
  "row-delete": "M4 5h16v8H4zM4 9h16M9 18h6",
  "col-delete": "M5 4h8v16H5zM9 4v16M15 12h6",
  "table-delete": "M4 5h16v14H4zM4 10h16M10 5v14M13 13l5 5M18 13l-5 5",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  paperclip: "M20.5 11.5l-8.5 8.5a5 5 0 0 1-7-7L13.5 4.5a3.5 3.5 0 0 1 5 5L10 18a2 2 0 0 1-3-3l7.5-7.5",
} as const;

export type SymbolName = keyof typeof SYMBOLS;

/** The floating-menu option each symbol draws. */
export const OPTION_SYMBOL: Readonly<Record<string, SymbolName>> = {
  inlineCode: "code",
  "size-up": "size-up",
  "size-down": "size-down",
  bullet: "list.bullet",
  ordered: "list.number",
  check: "checklist",
  indent: "increase.indent",
  quote: "quote",
  codeblock: "curlybraces",
  hr: "divider",
  table: "table",
  "row-above": "row-above",
  "row-below": "row-below",
  "col-left": "col-left",
  "col-right": "col-right",
  "row-delete": "row-delete",
  "col-delete": "col-delete",
  "table-delete": "table-delete",
  link: "link",
  insert: "paperclip",
};

const SVG = "http://www.w3.org/2000/svg";

/** A decorative outline symbol (the button's name is its label, WCAG 2.5.3). */
export function svgSymbol(name: SymbolName): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.dataset.symbol = name;
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", SYMBOLS[name]);
  svg.append(path);
  return svg;
}

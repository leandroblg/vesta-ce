// Read-only rendering of titles, reminders and details (FR-037, research §5): one pipeline, cached,
// with a plain-text fast path. The HTML carries data attributes only; `applyRendered` applies the
// span styles through the CSSOM, because the CSP blocks style attributes.
import { unified, type Processor } from "unified";
import { paintSpan } from "./paint";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype, { type Options as RehypeOptions } from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { Element, ElementContent, Root as HastRoot, RootContent as HastContent } from "hast";
import type { Root } from "mdast";
import { refractor } from "refractor";
import { isValidSize, spans, type Mark, type VestaSpan } from "../../domain/markdown/spans";
import { isAssetRef } from "../../domain/markdown/assets";
import { ASSET_PROTOCOL, linkTitleOf } from "../../domain/markdown/policy";
import { flattenToTitleScope } from "../../domain/markdown/title-scope";
import { youtubeEmbedId } from "../../domain/markdown/policy";
import { sanitizeHtml } from "./sanitize";

/** 009: "release" is the details grammar for release notes, with no embed and nothing loaded (FR-025a). */
export type RenderScope = "title" | "reminder" | "details" | "release";
export type Rendered = { html: string; hasEmbeds: boolean };

const handlers: RehypeOptions["handlers"] = {
  vestaSpan: (state, node: VestaSpan): Element => {
    const { color, bg, size, underline } = node.attributes;
    const properties: Element["properties"] = { dataVestaSpan: "" };
    if (color !== null) properties.dataColor = color;
    if (bg !== null) properties.dataBg = bg;
    if (size !== null) properties.dataSize = size;
    if (underline) properties.dataUnderline = "";
    return { type: "element", tagName: "span", properties, children: state.all(node) };
  },
  mark: (state, node: Mark): Element => ({
    type: "element",
    tagName: "mark",
    properties: {},
    children: state.all(node),
  }),
};

const textOf = (node: ElementContent | HastContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(textOf).join("") : "";

function visitElements(
  node: HastRoot | Element,
  visit: (el: Element, index: number, parent: HastRoot | Element) => void,
): void {
  node.children.forEach((child, index) => {
    if (child.type !== "element") return;
    visit(child, index, node);
    visitElements(child, visit);
  });
}

/** Code highlighting, checklists and YouTube lines, as data attributes (no classes survive sanitizing). */
function rehypeVesta(state: { embeds: boolean }, allowEmbeds = true) {
  return () => (tree: HastRoot) => {
    visitElements(tree, (el, index, parent) => {
      if (el.tagName === "code" && parent.type === "element" && parent.tagName === "pre") {
        const classes = Array.isArray(el.properties.className) ? el.properties.className.map(String) : [];
        const lang = classes.find((c) => c.startsWith("language-"))?.slice("language-".length);
        el.properties = lang === undefined ? {} : { dataLang: lang };
        if (lang !== undefined && refractor.registered(lang)) {
          const highlighted = refractor.highlight(textOf(el), lang);
          el.children = highlighted.children.map(tokensToData) as ElementContent[];
        }
        return;
      }
      if ((el.tagName === "td" || el.tagName === "th") && typeof el.properties.align === "string") {
        el.properties = { ...el.properties, dataAlign: el.properties.align, align: undefined };
        return;
      }
      if (el.tagName === "input" && el.properties.type === "checkbox") {
        const checked = el.properties.checked === true;
        parent.children[index] = {
          type: "element",
          tagName: "span",
          properties: { dataMdCheck: "", role: "checkbox", ariaChecked: String(checked), ariaDisabled: "true" },
          children: [],
        };
        return;
      }
      if (el.tagName === "p" && parent.type === "root") {
        const kids = el.children.filter((c) => !(c.type === "text" && c.value.trim() === ""));
        const only = kids.length === 1 ? kids[0] : undefined;
        const url = only === undefined ? "" : textOf(only).trim();
        const isLine =
          only?.type === "text" || (only?.type === "element" && only.tagName === "a" && only.properties.href === url);
        const id = isLine && allowEmbeds ? youtubeEmbedId(url) : null;
        if (id === null) return;
        state.embeds = true;
        parent.children[index] = {
          type: "element",
          tagName: "div",
          properties: { dataYt: id },
          children: [
            { type: "element", tagName: "a", properties: { href: url }, children: [{ type: "text", value: url }] },
          ],
        };
      }
    });
  };
}

function tokensToData(node: HastContent): HastContent {
  if (node.type !== "element") return node;
  const classes = Array.isArray(node.properties.className) ? node.properties.className.map(String) : [];
  const kinds = classes.filter((c) => c !== "token").join(" ");
  return {
    ...node,
    properties: kinds === "" ? {} : { dataTk: kinds },
    children: node.children.map((c) => tokensToData(c) as ElementContent),
  };
}

let parses = 0;
const embedState = { embeds: false };

function titleProcessor(): Processor<Root, HastRoot, HastRoot, HastRoot, string> {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(spans)
    .use(() => (tree: Root, file) => {
      flattenToTitleScope(tree, typeof file.value === "string" ? file.value : "");
    })
    .use(remarkRehype, { handlers })
    .use(rehypeTitle)
    .use(rehypeStringify) as never;
}

/** A title renders inline: its paragraph is unwrapped and a heading becomes a sized span (no h1 per card). */
const rehypeTitle = () => (tree: HastRoot) => {
  tree.children = tree.children.flatMap((node): HastContent[] => {
    if (node.type !== "element") return node.type === "text" && node.value.trim() === "" ? [] : [node];
    if (node.tagName === "p") return node.children;
    const level = /^h([1-6])$/.exec(node.tagName)?.[1];
    if (level !== undefined) return [{ ...node, tagName: "span", properties: { dataHeading: level } }];
    return [node];
  });
};

function detailsProcessor(allowEmbeds = true): Processor<Root, HastRoot, HastRoot, HastRoot, string> {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(spans)
    .use(remarkRehype, { handlers, allowDangerousHtml: true })
    .use(rehypeVesta(embedState, allowEmbeds))
    .use(rehypeStringify, { allowDangerousHtml: true }) as never;
}

const processors = { title: titleProcessor(), details: detailsProcessor(), release: detailsProcessor(false) };

// Titles without any markdown or HTML character are rendered as escaped text, with no parse (SC-003).
const NEEDS_PARSE = /[*_`[\]{}=~<>!:#\\@|]|&[#\w]+;|https?:|www\./i;
const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CACHE_SIZE = 2000;
const cache = new Map<string, Rendered>();

export function renderMarkdown(md: string, scope: RenderScope): Rendered {
  const kind = scope === "details" || scope === "release" ? scope : "title";
  const key = `${kind}\u0000${md}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  let result: Rendered;
  if (kind === "title" && !NEEDS_PARSE.test(md)) {
    result = { html: escapeHtml(md.trim()), hasEmbeds: false };
  } else {
    parses++;
    embedState.embeds = false;
    const html = String(processors[kind].processSync(md)).trim();
    result = { html: sanitizeHtml(html, { release: kind === "release" }), hasEmbeds: embedState.embeds };
  }
  cache.set(key, result);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}

/**
 * Applies span colors and sizes through the CSSOM (the CSP forbids style attributes), and names every link's
 * destination in its tooltip (010 FR-027, I2): the host, the mail address, or the stored file's name; a title in
 * the source markup is replaced, never kept.
 */
export function applyRendered(root: ParentNode): void {
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    const title = linkTitleOf(href) ?? (isAssetRef(href) || href.startsWith(ASSET_PROTOCOL) ? a.textContent.trim() : null);
    if (title === null || title === "") a.removeAttribute("title");
    else a.setAttribute("title", title);
  }
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-vesta-span]"))) {
    const size = el.dataset.size;
    if (size !== undefined && isValidSize(size)) el.style.fontSize = size;
    // 011 FR-009: colors are drawn readable for the active theme; the stored ones stay in the data attributes.
    paintSpan(el);
  }
}

export function clearRenderCache(): void {
  cache.clear();
}

export function renderStats(): { parses: number; cached: number } {
  return { parses, cached: cache.size };
}

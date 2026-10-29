// Sanitizing every rendering (FR-035, FR-035a, research §6): DOMPurify configured from the domain policy.
// The same function serves the read-only renderer and the editor's HTML node views.
import DOMPurify from "dompurify";
import {
  ALLOWED_ATTR,
  ALLOWED_TAGS,
  ASSET_PROTOCOL,
  FORBID_TAGS,
  imageAllowed,
  linkAllowed,
  youtubeEmbedId,
  youtubeNocookieUrl,
} from "../../domain/markdown/policy";
import { isAssetRef } from "../../domain/markdown/assets";

/** Data attributes Vesta's own markup uses for styling and behaviour; every other data attribute is removed. */
const DATA_ATTRS = new Set([
  ...["data-vesta-span", "data-color", "data-bg", "data-size", "data-underline"],
  ...[
    "data-tk",
    "data-lang",
    "data-yt",
    "data-md-check",
    "data-md-placeholder",
    "data-url",
    "data-heading",
    "data-align",
  ],
]);

const SANDBOX = "allow-scripts allow-same-origin allow-presentation";

const purify = DOMPurify(window);

purify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe" || !(node instanceof Element)) return;
  if (youtubeEmbedId(node.getAttribute("src") ?? "") === null) node.parentNode?.removeChild(node);
});

purify.addHook("uponSanitizeAttribute", (node, data) => {
  const name = data.attrName;
  if (name.startsWith("data-")) data.keepAttr = DATA_ATTRS.has(name);
  else if (name === "role") data.keepAttr = data.attrValue === "checkbox" && node.hasAttribute("data-md-check");
  else if (name.startsWith("aria-"))
    data.keepAttr = ["aria-checked", "aria-disabled"].includes(name) && node.hasAttribute("data-md-check");
  else if (["width", "height", "allowfullscreen"].includes(name)) data.keepAttr = node.nodeName === "IFRAME";
});

purify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "IFRAME" || !(node instanceof Element)) return;
  const id = youtubeEmbedId(node.getAttribute("src") ?? "");
  if (id === null) return;
  node.setAttribute("src", youtubeNocookieUrl(id));
  node.setAttribute("sandbox", SANDBOX);
  node.setAttribute("referrerpolicy", "no-referrer");
  node.setAttribute("loading", "lazy");
});

const CONFIG = {
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: [...ALLOWED_ATTR, "role", "aria-checked", "aria-disabled"],
  FORBID_TAGS: [...FORBID_TAGS],
  FORBID_ATTR: ["style", "class", "id"],
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|vesta-asset):|assets\/)/i,
  // Plain values, not URLs: without this DOMPurify checks them against the URI pattern above.
  ADD_URI_SAFE_ATTR: ["width", "height", "colspan", "rowspan", "role"],
  RETURN_DOM_FRAGMENT: true as const,
};

function unwrap(el: Element): void {
  el.replaceWith(...Array.from(el.childNodes));
}

/**
 * 016 FR-016c (PRD Q255, Q257): a link whose address is not safe keeps its link look, as a focusable placeholder that
 * carries no address at all; a click or Enter on it says it will not be opened, and nothing opens.
 */
function unsafePlaceholder(a: Element): void {
  const span = document.createElement("span");
  span.setAttribute("data-unsafe-link", "");
  span.setAttribute("role", "link");
  span.setAttribute("tabindex", "0");
  span.className = "md-unsafe-link";
  span.append(...Array.from(a.childNodes));
  a.replaceWith(span);
}

/** Links and images after DOMPurify: scheme rules, stored files through `vesta-asset://`, remote images as placeholders. */
function postPass(root: DocumentFragment): void {
  for (const a of Array.from(root.querySelectorAll("a"))) {
    const href = a.getAttribute("href") ?? "";
    if (!linkAllowed(href)) unsafePlaceholder(a);
    else if (isAssetRef(href)) a.setAttribute("href", ASSET_PROTOCOL + href);
  }
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (imageAllowed(src)) {
      if (isAssetRef(src)) img.setAttribute("src", ASSET_PROTOCOL + src);
      continue;
    }
    const placeholder = document.createElement("span");
    placeholder.setAttribute("data-md-placeholder", "remote-image");
    placeholder.setAttribute("data-url", src);
    placeholder.textContent = src;
    img.replaceWith(placeholder);
  }
}

// Fail closed: if DOMPurify cannot work in this DOM, every rendering becomes escaped text.
function selfTest(): boolean {
  if (!purify.isSupported) return false;
  const holder = document.createElement("div");
  holder.append(purify.sanitize('<b onclick="x()">ok</b><script>x()</script>', CONFIG));
  return holder.innerHTML === "<b>ok</b>";
}
let working: boolean | null = null;

function escapeText(html: string): string {
  const holder = document.createElement("div");
  holder.textContent = html;
  return holder.innerHTML;
}

/**
 * 009 FR-025a: release notes load nothing. Every image (stored files too) becomes its text, and an embedded
 * player becomes a plain link, so the notes cause no request at all.
 */
function releasePass(root: DocumentFragment): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    const local = src.startsWith(ASSET_PROTOCOL);
    const placeholder = document.createElement("span");
    placeholder.setAttribute("data-md-placeholder", "remote-image");
    if (!local) placeholder.setAttribute("data-url", src);
    placeholder.textContent = img.getAttribute("alt") ?? (local ? "" : src);
    img.replaceWith(placeholder);
  }
  for (const frame of Array.from(root.querySelectorAll("iframe, video, audio, source, object, embed"))) {
    const src = frame.getAttribute("src") ?? "";
    if (linkAllowed(src) && !isAssetRef(src)) {
      const a = document.createElement("a");
      a.setAttribute("href", src);
      a.textContent = src;
      frame.replaceWith(a);
    } else {
      frame.remove();
    }
  }
  for (const a of Array.from(root.querySelectorAll("a"))) {
    // Stored files belong to this computer's data, not to a release.
    if ((a.getAttribute("href") ?? "").startsWith(ASSET_PROTOCOL)) unwrap(a);
  }
}

/** Sanitized HTML, ready for `innerHTML`. */
export function sanitizeHtml(html: string, options: { release?: boolean } = {}): string {
  working ??= selfTest();
  if (!working) return escapeText(html);
  const fragment = purify.sanitize(html, CONFIG);
  postPass(fragment);
  if (options.release === true) releasePass(fragment);
  const holder = document.createElement("div");
  holder.append(fragment);
  return holder.innerHTML;
}

// The sanitization policy of FR-035 and FR-035a as data. The renderer's DOMPurify setup reads it,
// so the editor's HTML node views and the read-only renderer always agree.
import { isAssetRef } from "./assets";

export const ALLOWED_TAGS: readonly string[] = [
  ...["b", "strong", "i", "em", "u", "s", "del", "mark", "sub", "sup", "small", "code", "kbd", "pre", "span"],
  ...["br", "p", "div", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "ul", "ol", "li"],
  ...["table", "thead", "tbody", "tr", "th", "td", "details", "summary", "a", "img"],
  // Kept only for allow-listed YouTube embeds (youtubeEmbedId).
  "iframe",
];

export const ALLOWED_ATTR: readonly string[] = [
  ...["href", "src", "alt", "title", "colspan", "rowspan", "open"],
  // YouTube iframe only.
  ...["width", "height", "allowfullscreen"],
];

/** Removed with their content. */
export const FORBID_TAGS: readonly string[] = [
  ...["script", "style", "noscript", "template"],
  ...["form", "input", "button", "textarea", "select", "option", "optgroup", "fieldset", "label", "datalist", "output"],
  ...["object", "embed", "applet", "frame", "frameset", "svg", "math", "base", "meta", "link"],
];

export const ASSET_PROTOCOL = "vesta-asset://";
export const LINK_SCHEMES: readonly string[] = ["http", "https", "mailto"];

// Browsers ignore ASCII whitespace and control characters inside a URL's scheme (`java\tscript:`).
const IGNORED = /[\p{Cc} ]/gu;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function storedFile(url: string): boolean {
  return isAssetRef(url) || (url.startsWith(ASSET_PROTOCOL) && isAssetRef(url.slice(ASSET_PROTOCOL.length)));
}

/** Links: `http`, `https`, `mailto` and stored files (FR-035a). */
export function linkAllowed(url: string): boolean {
  const compact = url.replace(IGNORED, "");
  if (storedFile(compact)) return true;
  const scheme = SCHEME.exec(compact)?.[1]?.toLowerCase();
  return scheme !== undefined && LINK_SCHEMES.includes(scheme) && compact === url.trim();
}

/** Images: stored files only (FR-035a); remote images show a placeholder (FR-036). */
export function imageAllowed(url: string): boolean {
  return storedFile(url.trim());
}

const ID = "([A-Za-z0-9_-]{11})";
const END = "(?:[?&#]|$)";
const YOUTUBE: readonly RegExp[] = [
  new RegExp(`^https://(?:www\\.)?youtube\\.com/watch\\?(?:[^#]*&)?v=${ID}(?:[&#]|$)`),
  new RegExp(`^https://youtu\\.be/${ID}${END}`),
  new RegExp(`^https://(?:www\\.)?youtube(?:-nocookie)?\\.com/embed/${ID}${END}`),
];

/** The 11-character video id of a YouTube watch, youtu.be or embed URL (https only), or null (FR-034, FR-035). */
export function youtubeEmbedId(url: string): string | null {
  for (const pattern of YOUTUBE) {
    const id = pattern.exec(url)?.[1];
    if (id !== undefined) return id;
  }
  return null;
}

/** 010 FR-015 (L2): exactly 11 characters of letters, digits, underscore and dash; the only id a player is built from. */
export function isYoutubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

/** 010 FR-027 (I2): what a link's tooltip names: the host of a web link, the address of a mail link, nothing else. */
export function linkTitleOf(href: string): string | null {
  if (/^https?:\/\//i.test(href)) {
    try {
      return new URL(href).host;
    } catch {
      return null;
    }
  }
  if (/^mailto:/i.test(href)) return href.slice("mailto:".length).split("?")[0] ?? null;
  return null;
}

export function youtubeNocookieUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

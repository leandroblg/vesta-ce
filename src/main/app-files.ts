/**
 * The pure part of the `app://vesta/` scheme the page is served from (010 research §2, audit L13, L6;
 * contracts/security-headers.md). No Electron import, so unit tests can cover containment and headers.
 */
import { extname, relative, resolve, isAbsolute, sep } from "node:path";
import { PRODUCTION_CSP } from "./csp";

export const APP_SCHEME = "app";
export const APP_HOST = "vesta";
/** The page's origin; `isTrustedSender` compares it exactly (L4). */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

/** Registered together with `vesta-asset` in the single `registerSchemesAsPrivileged` call, before `ready`. */
export const APP_SCHEME_PRIVILEGES = {
  scheme: APP_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
} as const;

/** What the built renderer folder may contain; anything else is 404. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  map: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  gif: "image/gif",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
};

/**
 * The file under `root` an `app://` URL names, or null: another host, a path that leaves `root` (`..`,
 * encoded or not, an absolute escape, a NUL byte) or an unparsable URL. `/` is `index.html`. The file's
 * existence is the caller's business.
 */
export function resolveAppPath(url: string, root: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  if (pathname === "" || pathname === "/") pathname = "/index.html";
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, `.${pathname}`);
  const rel = relative(absoluteRoot, target);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return target;
}

/** The lowercased extension without its dot (`""` when none). */
export function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

/**
 * Response headers for a file of this extension, or null when the type is unknown (404). Every response is
 * `nosniff`; HTML documents also carry the production policy as a header (L6).
 */
export function appHeaders(ext: string): Record<string, string> | null {
  const type = CONTENT_TYPES[ext];
  if (type === undefined) return null;
  const headers: Record<string, string> = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
  if (ext === "html") headers["Content-Security-Policy"] = PRODUCTION_CSP;
  return headers;
}

export const NOT_FOUND_HEADERS: Readonly<Record<string, string>> = { "X-Content-Type-Options": "nosniff" };

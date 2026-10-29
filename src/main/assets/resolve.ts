// Maps a `vesta-asset://` URL to a stored file (FR-030): a reference to a row whose file exists. The hash is the
// file's identity (008 research §9): a reference with another extension serves the stored file.
import { statSync } from "node:fs";
import { storedFilePath } from "./path";

const URL_FORM = /^vesta-asset:\/\/assets\/([0-9a-f]{64})(?:\.([a-z0-9]{1,16}))?$/;

export interface AssetLookup {
  /** The data folder. */
  dir: string;
  find: (hash: string) => { ext: string; mimeType: string } | null;
}

export function resolveAssetUrl(
  url: string,
  { dir, find }: AssetLookup,
): { path: string; mimeType: string; size: number } | null {
  const match = URL_FORM.exec(url);
  const hash = match?.[1];
  if (hash === undefined) return null;
  const row = find(hash);
  if (row === null) return null;
  // 016 FR-016b: only a file inside the stored-files folder is served.
  const path = storedFilePath(dir, row.ext === "" ? hash : `${hash}.${row.ext}`);
  if (path === null) return null;
  try {
    const stat = statSync(path);
    return stat.isFile() ? { path, mimeType: row.mimeType, size: stat.size } : null;
  } catch {
    return null;
  }
}

/** Headers of a 404 answer: never sniffed (005 FR-030). */
export const ASSET_NOT_FOUND_HEADERS: Readonly<Record<string, string>> = { "X-Content-Type-Options": "nosniff" };

/**
 * 010 FR-005 (M2, L15): a stored file is served inert and uncached: a sandboxing policy that lets it load nothing, a
 * disposition of attachment (which leaves `<img>` subresources untouched), no sniffing, and no caching.
 */
export function assetResponseHeaders(found: { mimeType: string; size: number }): Record<string, string> {
  return {
    "Content-Type": found.mimeType,
    "Content-Length": String(found.size),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Content-Disposition": "attachment",
    "Cache-Control": "no-store",
  };
}

/** 010 FR-010 (L1): the set of unknown addresses warned about stays bounded. */
export const MAX_LOGGED_UNKNOWN_ASSETS = 1_000;

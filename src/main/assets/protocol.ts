// The `vesta-asset://` protocol for stored files (FR-030, contracts/ipc.md).
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { APP_SCHEME_PRIVILEGES } from "../app-files";
import { ASSET_NOT_FOUND_HEADERS, MAX_LOGGED_UNKNOWN_ASSETS, assetResponseHeaders, resolveAssetUrl, type AssetLookup } from "./resolve";

export const ASSET_SCHEME = "vesta-asset";

/** Must run before `app.ready`, once: the asset scheme (standard, secure, no fetch, no CORS) and the page's `app` scheme (010 L13). */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false } },
    { scheme: APP_SCHEME_PRIVILEGES.scheme, privileges: { ...APP_SCHEME_PRIVILEGES.privileges } },
  ]);
}

/** Serves stored files; anything else is a 404, logged once per URL (FR-033). */
export function handleAssetProtocol(lookup: () => AssetLookup, warn: (url: string) => void): void {
  const logged = new Set<string>();
  protocol.handle(ASSET_SCHEME, (request) => {
    const found = (() => {
      try {
        return resolveAssetUrl(request.url, lookup());
      } catch {
        return null;
      }
    })();
    if (found === null) {
      if (!logged.has(request.url)) {
        // 010 L1: bounded; once full the set starts over, so a flood costs repeated log lines, not memory.
        if (logged.size >= MAX_LOGGED_UNKNOWN_ASSETS) logged.clear();
        logged.add(request.url);
        warn(request.url);
      }
      return new Response(null, { status: 404, headers: { ...ASSET_NOT_FOUND_HEADERS } });
    }
    const body = Readable.toWeb(createReadStream(found.path)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers: assetResponseHeaders(found) });
  });
}

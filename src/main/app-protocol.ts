/** Serves the built renderer folder over `app://vesta/` (010 research §2; contracts/security-headers.md). */
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { APP_SCHEME, NOT_FOUND_HEADERS, appHeaders, extensionOf, resolveAppPath } from "./app-files";

/** Must run after `app.ready`; the scheme itself is registered with `vesta-asset` before (protocol.ts). */
export function handleAppProtocol(root: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const path = resolveAppPath(request.url, root);
    const headers = path === null ? null : appHeaders(extensionOf(path));
    if (path === null || headers === null) return new Response(null, { status: 404, headers: { ...NOT_FOUND_HEADERS } });
    let size: number;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error("not a file");
      size = stat.size;
    } catch {
      return new Response(null, { status: 404, headers: { ...NOT_FOUND_HEADERS } });
    }
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  });
}

/** Production Content Security Policy for the renderer (research.md §9). */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: vesta-asset:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src https://www.youtube-nocookie.com",
  "base-uri 'none'",
  "form-action 'none'",
  // 010 L6 (FR-020): explicit worker and media directives, so nothing falls back to the default.
  "worker-src 'self'",
  "media-src 'self' vesta-asset:",
].join("; ");

/**
 * 010 FR-020 (L6): the development server's pages carry this policy as a header. It is the production policy with
 * what React refresh needs (an inline preamble) and the dev websocket; it is never shipped.
 */
export function DEV_CSP(devOrigin: string): string {
  const host = new URL(devOrigin).host;
  return PRODUCTION_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace(
    "connect-src 'none'",
    `connect-src ws://${host} http://${host}`,
  );
}

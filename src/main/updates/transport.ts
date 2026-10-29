/**
 * How the update request travels (009 research §8, contracts/ipc.md "Test transport"). In production it is
 * `net.fetch` on the default session, so the session allow-list applies (FR-022). Unpackaged builds started with
 * VESTA_TEST_RELEASES use a fixture transport instead, which records each request and answers from a source.
 */
import { readFileSync } from "node:fs";

export interface TransportInit {
  method: "GET";
  headers: Record<string, string>;
  credentials: "omit";
  cache: "no-store";
  redirect: "manual";
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type UpdateTransport = (url: string, init: TransportInit) => Promise<TransportResponse>;

/**
 * The production transport: exactly the options it is given, nothing added (FR-022a; analysis M2). Electron's
 * `net.fetch` rejects a redirect under `redirect: "manual"` ("Redirect was cancelled") instead of returning it;
 * that becomes a 302 with no location, so the check ends as a redirect failure, never followed (T069).
 */
export function createNetTransport(fetchFn: (url: string, init: TransportInit) => Promise<TransportResponse>): UpdateTransport {
  return async (url, init) => {
    try {
      return await fetchFn(url, init);
    } catch (err) {
      if (err instanceof Error && /redirect was cancelled/i.test(err.message)) {
        return { status: 302, headers: { get: () => null }, text: () => Promise.resolve("") };
      }
      throw err;
    }
  };
}

/** What the fixture answers (contracts/ipc.md `setReleases`). */
export type ReleaseSource =
  | { status: number; body: unknown; headers?: Record<string, string>; redirect?: string; delayMs?: number }
  | { fail: "offline" | "timeout"; delayMs?: number };

export const EMPTY_SOURCE: ReleaseSource = { status: 200, body: [] };

/** VESTA_TEST_RELEASES: `empty`, or a path to a JSON source. */
export function readSourceSetting(value: string): ReleaseSource {
  if (value === "empty") return EMPTY_SOURCE;
  return JSON.parse(readFileSync(value, "utf8")) as ReleaseSource;
}

export interface FixtureTransport {
  transport: UpdateTransport;
  setSource(source: ReleaseSource): void;
  requests(): { url: string; headers: Record<string, string> }[];
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

export function createFixtureTransport(initial: ReleaseSource): FixtureTransport {
  let source = initial;
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const transport: UpdateTransport = async (url, init) => {
    seen.push({ url, headers: { ...init.headers } });
    const s = source;
    if (s.delayMs !== undefined) await wait(s.delayMs, init.signal);
    if ("fail" in s) {
      if (s.fail === "timeout") await wait(1e9, init.signal);
      throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
    }
    const headers = new Map(Object.entries(s.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (s.redirect !== undefined && url !== s.redirect) {
      return { status: 302, headers: { get: (n) => (n.toLowerCase() === "location" ? (s.redirect ?? null) : null) }, text: () => Promise.resolve("") };
    }
    return { status: s.status, headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, text: () => Promise.resolve(typeof s.body === "string" ? s.body : JSON.stringify(s.body)) };
  };
  return {
    transport,
    setSource(next) {
      source = next;
    },
    requests: () => seen.map((r) => ({ url: r.url, headers: { ...r.headers } })),
  };
}

/** The probe may only aim at blocked addresses, so a test can never send a real request (FR-028; analysis I2). */
export function assertProbeAllowed(url: string, allowed: (url: string) => boolean): void {
  if (allowed(url)) throw new Error(`probeBlockedFetch refuses an allowed address: ${url}`);
}

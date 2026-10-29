/**
 * One update check (009 FR-021 to FR-022c, FR-026, research §8): one plain GET of the release list with only
 * `Accept` and `User-Agent: Vesta`, no credentials and no cache, redirects followed by hand only within
 * https://api.github.com/ and at most 3 hops, a 15 s timeout. Failures are logged at Warn and returned, never
 * thrown; no fallback host is tried.
 */
import { readReleases, type CheckOutcome, type RepoRef } from "../../domain/updates/releases";
import { errorMessage, type Logger } from "../log";
import { releasesUrl } from "./repo";
import type { TransportInit, UpdateTransport } from "./transport";

export const CHECK_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const API = "https://api.github.com/";

export interface CheckDeps {
  transport: UpdateTransport;
  repo: RepoRef;
  running: string;
  platform: string;
  arch: string;
  log: Pick<Logger, "warn" | "debug">;
  timeoutMs?: number;
}

type Failed = Extract<CheckOutcome, { kind: "failed" }>;

export async function checkForUpdate(deps: CheckDeps): Promise<CheckOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, deps.timeoutMs ?? CHECK_TIMEOUT_MS);
  const t0 = performance.now();
  const fail = (reason: Failed["reason"], status: number | null = null): Failed => {
    deps.log.warn("update.check.failed", { reason, status });
    return { kind: "failed", reason };
  };
  try {
    deps.log.debug("update.check.start", {});
    let url = releasesUrl(deps.repo);
    const init: TransportInit = {
      method: "GET",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Vesta" },
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    };
    for (let hops = 0; ; hops++) {
      let res;
      try {
        res = await deps.transport(url, init);
      } catch (err) {
        if (controller.signal.aborted) return fail("timeout");
        deps.log.debug("update.check.error", { message: errorMessage(err) });
        return fail(/blocked/i.test(errorMessage(err)) ? "blocked" : "offline");
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        const next = location === null ? null : new URL(location, url).toString();
        if (next === null || !next.startsWith(API) || hops + 1 > MAX_REDIRECTS) return fail("redirect", res.status);
        url = next;
        continue;
      }
      if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) return fail("rateLimited", res.status);
      if (res.status !== 200) return fail("status", res.status);
      let json: unknown;
      try {
        json = JSON.parse(await res.text());
      } catch {
        if (controller.signal.aborted) return fail("timeout");
        return fail("unreadable", res.status);
      }
      const { outcome, ignored } = readReleases(json, { running: deps.running, platform: deps.platform, arch: deps.arch, repo: deps.repo });
      for (const reason of ignored) deps.log.warn("update.release-ignored", { reason });
      if (outcome.kind === "failed") return fail(outcome.reason, res.status);
      deps.log.debug("update.check.end", { ms: Math.round(performance.now() - t0), outcome: outcome.kind });
      return outcome;
    }
  } finally {
    clearTimeout(timer);
  }
}

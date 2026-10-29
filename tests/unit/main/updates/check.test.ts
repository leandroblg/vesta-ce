import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, CHECK_TIMEOUT_MS } from "../../../../src/main/updates/check";
import type { TransportInit, TransportResponse, UpdateTransport } from "../../../../src/main/updates/transport";

const REPO = { owner: "OWNER", repo: "vesta" };
const URL0 = "https://api.github.com/repos/OWNER/vesta/releases?per_page=20";
const BASE = "https://github.com/OWNER/vesta/releases";
const release = (v: string) => ({
  tag_name: `v${v}`,
  draft: false,
  prerelease: false,
  html_url: `${BASE}/tag/v${v}`,
  body: "notes",
  assets: [{ name: `Vesta-${v}-mac-arm64.zip`, browser_download_url: `${BASE}/download/v${v}/Vesta-${v}-mac-arm64.zip` }],
});

const reply = (status: number, body: unknown = "", headers: Record<string, string> = {}): TransportResponse => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
});

function setup(answers: ((url: string, init: TransportInit) => Promise<TransportResponse>)[]) {
  const calls: { url: string; init: TransportInit }[] = [];
  const transport: UpdateTransport = (url, init) => {
    calls.push({ url, init });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (next === undefined) throw new Error("no answer");
    return next(url, init);
  };
  const log = { warn: vi.fn(), debug: vi.fn() };
  const run = () => checkForUpdate({ transport, repo: REPO, running: "0.1.0", platform: "darwin", arch: "arm64", log });
  return { calls, log, run };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("checkForUpdate (009 FR-021 to FR-022c, FR-026, research §8)", () => {
  it("sends one plain GET of the release list: only Accept and User-Agent: Vesta, no credentials, no cache", async () => {
    const { calls, run } = setup([() => Promise.resolve(reply(200, [release("0.2.0")]))]);
    expect(await run()).toMatchObject({ kind: "available", release: { version: "0.2.0" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(URL0);
    const { signal, ...init } = calls[0]?.init ?? ({} as TransportInit);
    expect(init).toEqual({
      method: "GET",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Vesta" },
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
    });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("follows up to 3 redirects within https://api.github.com/, and fails on a 4th or any other host", async () => {
    const to = (u: string) => () => Promise.resolve(reply(301, "", { location: u }));
    const ok = () => Promise.resolve(reply(200, []));
    const a = setup([to("/repositories/1/releases?per_page=20"), to("https://api.github.com/repositories/2/releases"), ok]);
    expect(await a.run()).toEqual({ kind: "upToDate" });
    expect(a.calls.map((c) => c.url)).toEqual([URL0, "https://api.github.com/repositories/1/releases?per_page=20", "https://api.github.com/repositories/2/releases"]);

    const b = setup([to("https://api.github.com/a"), to("https://api.github.com/b"), to("https://api.github.com/c"), to("https://api.github.com/d"), ok]);
    expect(await b.run()).toEqual({ kind: "failed", reason: "redirect" });
    expect(b.calls).toHaveLength(4);

    const c = setup([to("https://objects.githubusercontent.com/x"), ok]);
    expect(await c.run()).toEqual({ kind: "failed", reason: "redirect" });
    expect(c.calls).toHaveLength(1);
    expect(c.log.warn).toHaveBeenCalledWith("update.check.failed", { reason: "redirect", status: 301 });
  });

  it("names every failure and logs it once at Warn with its reason and status only (FR-026)", async () => {
    const cases: [() => Promise<TransportResponse>, string, number | null][] = [
      [() => Promise.resolve(reply(403, "{}", { "x-ratelimit-remaining": "0" })), "rateLimited", 403],
      [() => Promise.resolve(reply(429)), "rateLimited", 429],
      [() => Promise.resolve(reply(404, "Not Found")), "status", 404],
      [() => Promise.resolve(reply(500)), "status", 500],
      [() => Promise.resolve(reply(200, "<html>")), "unreadable", 200],
      [() => Promise.resolve(reply(200, { message: "x" })), "unreadable", 200],
      [() => Promise.reject(new TypeError("net::ERR_INTERNET_DISCONNECTED")), "offline", null],
      [() => Promise.reject(new Error("net::ERR_BLOCKED_BY_CLIENT")), "blocked", null],
    ];
    for (const [answer, reason, status] of cases) {
      const { log, run } = setup([answer]);
      expect(await run(), reason).toEqual({ kind: "failed", reason });
      expect(log.warn.mock.calls, reason).toEqual([["update.check.failed", { reason, status }]]);
      expect(JSON.stringify(log.warn.mock.calls) + JSON.stringify(log.debug.mock.calls)).not.toMatch(/Not Found|<html>|ratelimit/);
    }
  });

  it("gives up after 15 s", async () => {
    vi.useFakeTimers();
    const hang = (_u: string, init: TransportInit) =>
      new Promise<TransportResponse>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    const { run } = setup([hang]);
    const outcome = run();
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    expect(await outcome).toEqual({ kind: "failed", reason: "timeout" });
    expect(CHECK_TIMEOUT_MS).toBe(15_000);
  });

  it("logs a release it had to ignore, and never tries another host", async () => {
    const { calls, log, run } = setup([() => Promise.resolve(reply(200, [{ tag_name: "nightly", draft: false, prerelease: false, html_url: `${BASE}/tag/n`, body: "", assets: [] }]))]);
    expect(await run()).toEqual({ kind: "upToDate" });
    expect(log.warn).toHaveBeenCalledWith("update.release-ignored", { reason: "release 0: unreadable version" });
    expect(calls.every((c) => c.url.startsWith("https://api.github.com/"))).toBe(true);
  });
});

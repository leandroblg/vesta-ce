// T056 (009 FR-022a, research §8; checklist CHK027) and the probe guard (analysis I2).
import { describe, expect, it, vi } from "vitest";
import { networkAllowed } from "../../../../src/main/security";
import { assertProbeAllowed, createFixtureTransport, createNetTransport, readSourceSetting, type TransportInit } from "../../../../src/main/updates/transport";

const REPO = { owner: "OWNER", repo: "vesta" };

describe("the production transport (net.fetch)", () => {
  it("hands net.fetch exactly the options the check built, nothing added", async () => {
    const fetchFn = vi.fn((_url: string, _init: TransportInit) => Promise.resolve({ status: 200, headers: { get: () => null }, text: () => Promise.resolve("[]") }));
    const init: TransportInit = {
      method: "GET",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Vesta" },
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: new AbortController().signal,
    };
    await createNetTransport(fetchFn)("https://api.github.com/repos/OWNER/vesta/releases?per_page=20", init);
    expect(fetchFn).toHaveBeenCalledWith("https://api.github.com/repos/OWNER/vesta/releases?per_page=20", init);
    expect(Object.keys(fetchFn.mock.calls[0]?.[1] ?? {}).sort()).toEqual(["cache", "credentials", "headers", "method", "redirect", "signal"]);
  });
});

describe("probeBlockedFetch's guard (FR-028, analysis I2)", () => {
  const allowed = (url: string) => networkAllowed(url, null, REPO);

  it("refuses the release list and the YouTube player, so a test can never reach them", () => {
    expect(() => {
      assertProbeAllowed("https://api.github.com/repos/OWNER/vesta/releases?per_page=20", allowed);
    }).toThrow();
    expect(() => {
      assertProbeAllowed("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", allowed);
    }).toThrow();
  });

  it("lets a blocked address through to the real transport", () => {
    expect(() => {
      assertProbeAllowed("https://example.com/", allowed);
    }).not.toThrow();
    expect(() => {
      assertProbeAllowed("https://api.github.com/users/x", allowed);
    }).not.toThrow();
  });
});

describe("the fixture transport (contracts/ipc.md \"Test transport\")", () => {
  const init = () => ({
    method: "GET" as const,
    headers: { "User-Agent": "Vesta" },
    credentials: "omit" as const,
    cache: "no-store" as const,
    redirect: "manual" as const,
    signal: new AbortController().signal,
  });

  it("answers `empty` with an empty list and records each request", async () => {
    const f = createFixtureTransport(readSourceSetting("empty"));
    const res = await f.transport("https://api.github.com/x", init());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("[]");
    expect(f.requests()).toEqual([{ url: "https://api.github.com/x", headers: { "User-Agent": "Vesta" } }]);
  });

  it("redirects once to the given address, fails on demand, and waits delayMs", async () => {
    const f = createFixtureTransport({ status: 200, body: [], redirect: "https://api.github.com/y" });
    expect((await f.transport("https://api.github.com/x", init())).status).toBe(302);
    expect((await f.transport("https://api.github.com/y", init())).status).toBe(200);
    f.setSource({ fail: "offline" });
    await expect(f.transport("https://api.github.com/x", init())).rejects.toThrow();
    vi.useFakeTimers();
    f.setSource({ status: 200, body: [], delayMs: 2000 });
    let done = false;
    void f.transport("https://api.github.com/x", init()).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

describe("a redirect in production (T069; FR-022a, FR-026)", () => {
  it("Electron's manual-redirect rejection ends the check as a redirect failure, not offline", async () => {
    const { checkForUpdate } = await import("../../../../src/main/updates/check");
    const fetchFn = vi.fn((_url: string, _init: TransportInit) => Promise.reject(new Error("Redirect was cancelled")));
    const log = { warn: vi.fn(), debug: vi.fn() };
    const outcome = await checkForUpdate({ transport: createNetTransport(fetchFn), repo: REPO, running: "0.1.0", platform: "darwin", arch: "arm64", log });
    expect(outcome).toEqual({ kind: "failed", reason: "redirect" });
    expect(log.warn).toHaveBeenCalledWith("update.check.failed", { reason: "redirect", status: 302 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("other transport errors still pass through unchanged", async () => {
    const fetchFn = vi.fn((_url: string, _init: TransportInit) => Promise.reject(new TypeError("net::ERR_INTERNET_DISCONNECTED")));
    await expect(createNetTransport(fetchFn)("https://api.github.com/x", {
      method: "GET",
      headers: {},
      credentials: "omit",
      cache: "no-store",
      redirect: "manual",
      signal: new AbortController().signal,
    })).rejects.toThrow("ERR_INTERNET_DISCONNECTED");
  });
});

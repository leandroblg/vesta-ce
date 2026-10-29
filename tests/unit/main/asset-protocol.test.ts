import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ASSET_NOT_FOUND_HEADERS, MAX_LOGGED_UNKNOWN_ASSETS, assetResponseHeaders, resolveAssetUrl } from "../../../src/main/assets/resolve";

const HASH = "0123456789abcdef".repeat(4);
const OTHER = "f".repeat(64);

describe("resolveAssetUrl (FR-030, contracts/ipc.md)", () => {
  let dir: string;
  const rows = new Map<string, { ext: string; mimeType: string }>();
  const deps = () => ({ dir, find: (hash: string) => rows.get(hash) ?? null });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vesta-assets-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", `${HASH}.png`), "png");
    writeFileSync(join(dir, "assets", OTHER), "bin");
    rows.set(HASH, { ext: "png", mimeType: "image/png" });
    rows.set(OTHER, { ext: "", mimeType: "application/octet-stream" });
  });
  afterEach(() => {
    rows.clear();
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a known hash with an existing file", () => {
    expect(resolveAssetUrl(`vesta-asset://assets/${HASH}.png`, deps())).toEqual({
      path: join(dir, "assets", `${HASH}.png`),
      mimeType: "image/png",
      size: 3,
    });
    expect(resolveAssetUrl(`vesta-asset://assets/${OTHER}`, deps())?.mimeType).toBe("application/octet-stream");
  });

  it.each([
    ["an unknown hash", `vesta-asset://assets/${"e".repeat(64)}.png`],
    ["a dot-dot path", `vesta-asset://assets/../${HASH}.png`],
    ["an encoded dot-dot path", `vesta-asset://assets/%2e%2e/${HASH}.png`],
    ["another host", `vesta-asset://files/${HASH}.png`],
    ["uppercase hex", `vesta-asset://assets/${HASH.toUpperCase()}.png`],
    ["a query", `vesta-asset://assets/${HASH}.png?x=1`],
    ["another scheme", `file:///assets/${HASH}.png`],
    ["a short hash", `vesta-asset://assets/${HASH.slice(1)}.png`],
  ])("refuses %s", (_case, url) => {
    expect(resolveAssetUrl(url, deps())).toBeNull();
  });

  it("serves the stored file by hash whatever the extension in the reference (008 research §9)", () => {
    const stored = { path: join(dir, "assets", `${HASH}.png`), mimeType: "image/png", size: 3 };
    expect(resolveAssetUrl(`vesta-asset://assets/${HASH}.jpg`, deps())).toEqual(stored);
    expect(resolveAssetUrl(`vesta-asset://assets/${HASH}`, deps())).toEqual(stored);
    expect(resolveAssetUrl(`vesta-asset://assets/${OTHER}.bin`, deps())?.path).toBe(join(dir, "assets", OTHER));
  });

  it("refuses a known hash whose file is missing", () => {
    rmSync(join(dir, "assets", `${HASH}.png`));
    expect(resolveAssetUrl(`vesta-asset://assets/${HASH}.png`, deps())).toBeNull();
  });
});

describe("M2/L15/L1 stored-file responses (010 FR-005, FR-010)", () => {
  it("M2/L15 are sandboxed attachments with no sniffing and no caching", () => {
    expect(assetResponseHeaders({ mimeType: "image/png", size: 3 })).toEqual({
      "Content-Type": "image/png",
      "Content-Length": "3",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Disposition": "attachment",
      "Cache-Control": "no-store",
    });
    expect(ASSET_NOT_FOUND_HEADERS).toEqual({ "X-Content-Type-Options": "nosniff" });
  });

  it("L1 the unknown-address set is bounded at 1,000", () => {
    expect(MAX_LOGGED_UNKNOWN_ASSETS).toBe(1_000);
  });
});

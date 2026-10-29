import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_INDEX_URL,
  APP_ORIGIN,
  APP_SCHEME_PRIVILEGES,
  NOT_FOUND_HEADERS,
  appHeaders,
  extensionOf,
  resolveAppPath,
} from "../../../src/main/app-files";
import { PRODUCTION_CSP } from "../../../src/main/csp";

const root = resolve("/srv/vesta/out/renderer");

describe("L13 app://vesta/ serving (010 research §2, contracts/security-headers.md)", () => {
  it("L13 names the origin and the index page", () => {
    expect(APP_ORIGIN).toBe("app://vesta");
    expect(APP_INDEX_URL).toBe("app://vesta/index.html");
    // Node parses `app:` as a non-special scheme (origin "null"); the origin is built from protocol and host.
    const parsed = new URL(APP_INDEX_URL);
    expect(`${parsed.protocol}//${parsed.host}`).toBe(APP_ORIGIN);
    expect(APP_SCHEME_PRIVILEGES).toEqual({
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
    });
  });

  it("L13 resolves files under the root and the index for the bare host", () => {
    expect(resolveAppPath("app://vesta/index.html", root)).toBe(join(root, "index.html"));
    expect(resolveAppPath("app://vesta/", root)).toBe(join(root, "index.html"));
    expect(resolveAppPath("app://vesta", root)).toBe(join(root, "index.html"));
    expect(resolveAppPath("app://vesta/assets/index-abc123.js", root)).toBe(join(root, "assets", "index-abc123.js"));
    expect(resolveAppPath("app://vesta/index.html?x=1", root)).toBe(join(root, "index.html"));
  });

  it.each([
    ["another host", "app://other/index.html"],
    ["another scheme", "file:///srv/vesta/out/renderer/index.html"],
    ["an encoded slash dot-dot path", "app://vesta/%2F..%2F..%2Fetc/passwd"],
    ["an encoded slash dot-dot after a folder", "app://vesta/assets%2F..%2F..%2F..%2Fsecret"],
    ["a NUL byte", "app://vesta/index.html%00.js"],
    ["an unparsable URL", "app://vesta/%E0%A4%A"],
  ])("L13 refuses %s", (_name, url) => {
    expect(resolveAppPath(url, root)).toBeNull();
  });

  it("L13 stays inside the root when the URL parser folds dot-dot segments", () => {
    // Standard schemes normalize `..` away; what remains must still be under the root.
    for (const url of ["app://vesta/../../etc/passwd", "app://vesta/%2e%2e/%2e%2e/etc/passwd", "app://vesta/assets/%2e%2e/%2e%2e/secret"]) {
      const path = resolveAppPath(url, root);
      expect(path === null || path.startsWith(root + "/")).toBe(true);
    }
  });

  it("L13/L6 sends nosniff on everything and the production policy on HTML only", () => {
    expect(appHeaders("html")).toEqual({
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": PRODUCTION_CSP,
    });
    expect(appHeaders("js")).toEqual({ "Content-Type": "text/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    expect(appHeaders("css")?.["Content-Security-Policy"]).toBeUndefined();
    expect(appHeaders("woff2")?.["Content-Type"]).toBe("font/woff2");
    expect(appHeaders("svg")?.["Content-Type"]).toBe("image/svg+xml");
  });

  it.each(["", "exe", "sqlite", "cjs", "wasm", "txt"])("L13 answers 404 headers for the unknown extension %j", (ext) => {
    expect(appHeaders(ext)).toBeNull();
    expect(NOT_FOUND_HEADERS).toEqual({ "X-Content-Type-Options": "nosniff" });
  });

  it("L13 lowercases the extension", () => {
    expect(extensionOf("/x/INDEX.HTML")).toBe("html");
    expect(extensionOf("/x/noext")).toBe("");
  });
});

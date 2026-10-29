/** 016 FR-015a, FR-016b, FR-016c (PRD Q245, Q255): which addresses Vesta links, opens or copies (data-model "Address classification"). */
import { describe, expect, it } from "vitest";
import { classifyAddress, isSafeAddress } from "../../../../src/domain/markdown/links";

const HASH = "a".repeat(64);

describe("classifyAddress", () => {
  it.each([
    ["https://example.com", "web"],
    ["http://example.com/a?b#c", "web"],
    ["HTTPS://EXAMPLE.COM", "web"],
    ["  https://example.com  ", "web"],
    ["mailto:someone@example.com", "mail"],
    ["MAILTO:someone@example.com", "mail"],
    [`assets/${HASH}`, "asset"],
    [`assets/${HASH}.pdf`, "asset"],
    ["file:///Users/me/a.pdf", "path"],
    ["/Users/me/a.pdf", "path"],
    ["C:\\Users\\me\\a.pdf", "path"],
    ["\\\\server\\share\\a.pdf", "path"],
  ] as const)("%s is %s", (raw, kind) => {
    expect(classifyAddress(raw)).toBe(kind);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:msgbox(1)",
    "vesta-asset://assets/x",
    "ftp://example.com/a",
    "slack://open",
    "example.com",
    "relative/page.html",
    "https://",
    "http:///path",
    "mailto:",
    `assets/${HASH.slice(1)}`,
    `assets/../${HASH}`,
    "",
    "   ",
  ])("%j is refused", (raw) => {
    expect(classifyAddress(raw)).toBe("refused");
  });

  it("isSafeAddress: a stored link may be opened or copied when it is web, mail or a stored file; a raw path may not", () => {
    expect(isSafeAddress("https://example.com")).toBe(true);
    expect(isSafeAddress("mailto:a@example.com")).toBe(true);
    expect(isSafeAddress(`assets/${HASH}.png`)).toBe(true);
    expect(isSafeAddress("javascript:alert(1)")).toBe(false);
    expect(isSafeAddress("file:///etc/passwd")).toBe(false);
    expect(isSafeAddress("/etc/passwd")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { DEV_CSP, PRODUCTION_CSP } from "../../../src/main/csp";

describe("production CSP (005 contracts/ipc.md; 010 L6)", () => {
  it("is exactly the 005 policy plus the 010 worker and media directives", () => {
    expect(PRODUCTION_CSP).toBe(
      [
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
        "worker-src 'self'",
        "media-src 'self' vesta-asset:",
      ].join("; "),
    );
  });

  it("never allows inline styles or scripts", () => {
    expect(PRODUCTION_CSP).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
  });
});

describe("L6 the development policy (010 FR-020, research §2)", () => {
  it("L6 DEV_CSP differs from the production policy only in script-src and connect-src", () => {
    const directives = (policy: string): Record<string, string> => Object.fromEntries(policy.split("; ").map((d): [string, string] => [d.split(" ")[0] ?? d, d]));
    const prod = directives(PRODUCTION_CSP);
    const dev = directives(DEV_CSP("http://localhost:5173"));
    expect(Object.keys(dev).sort()).toEqual(Object.keys(prod).sort());
    for (const name of Object.keys(prod)) {
      if (name === "script-src" || name === "connect-src") continue;
      expect(dev[name], name).toBe(prod[name]);
    }
    expect(dev["script-src"]).toBe("script-src 'self' 'unsafe-inline'");
    expect(dev["connect-src"]).toBe("connect-src ws://localhost:5173 http://localhost:5173");
  });

  it("L6 the production policy never allows inline script", () => {
    expect(PRODUCTION_CSP).not.toContain("unsafe-inline");
    expect(PRODUCTION_CSP).not.toContain("unsafe-eval");
  });
});

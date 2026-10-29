import { describe, expect, it } from "vitest";
import type { Session } from "electron";
import { DEV_CSP } from "../../../src/main/csp";
import { applySessionSecurity, frameNavigationAllowed, isTrustedSender } from "../../../src/main/security";

const mainFrame = { url: "app://vesta/index.html" };

describe("L4 trusted senders (010 FR-019, research §2)", () => {
  it("L4 accepts only the main window's main frame on the app origin", () => {
    expect(isTrustedSender(mainFrame, mainFrame, null)).toBe(true);
    expect(isTrustedSender({ ...mainFrame, url: "app://vesta/other.html" }, mainFrame, null)).toBe(false); // another frame object
    const same = { url: "app://vesta/other" };
    expect(isTrustedSender(same, same, null)).toBe(true); // the main frame, wherever it is on the origin
  });

  it("L4 refuses a subframe, another window, a file:// page and a foreign origin", () => {
    const sub = { url: "https://www.youtube-nocookie.com/embed/x" };
    expect(isTrustedSender(sub, mainFrame, null)).toBe(false);
    const other = { url: "app://vesta/index.html" };
    expect(isTrustedSender(other, mainFrame, null)).toBe(false);
    const file = { url: "file:///Users/ana/Vesta/out/renderer/index.html" };
    expect(isTrustedSender(file, file, null)).toBe(false);
    const evil = { url: "app://vesta.evil/index.html" };
    expect(isTrustedSender(evil, evil, null)).toBe(false);
    expect(isTrustedSender(null, mainFrame, null)).toBe(false);
    expect(isTrustedSender(undefined, mainFrame, null)).toBe(false);
    expect(isTrustedSender(mainFrame, null, null)).toBe(false);
  });

  it("L4 accepts the development server's origin only when one is set", () => {
    const dev = { url: "http://localhost:5173/" };
    expect(isTrustedSender(dev, dev, "http://localhost:5173")).toBe(true);
    expect(isTrustedSender(dev, dev, null)).toBe(false);
    expect(isTrustedSender({ url: "http://localhost:5174/" }, dev, "http://localhost:5173")).toBe(false);
    expect(isTrustedSender(dev, mainFrame, "http://localhost:5173")).toBe(false); // not the main frame
  });
});

describe("L3 frame navigation (010 FR-016)", () => {
  it.each([
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    "https://www.youtube-nocookie.com/",
    "https://www.youtube-nocookie.com",
  ])("L3 lets a subframe stay on the player origin: %s", (url) => {
    expect(frameNavigationAllowed(url, false)).toBe(true);
  });

  it.each([
    "https://example.com/",
    "https://www.youtube.com/watch?v=x",
    "https://www.youtube-nocookie.com.evil.com/",
    "https://evil.com/?u=https://www.youtube-nocookie.com/",
    "app://vesta/index.html",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ])("L3 cancels a subframe navigation to %s", (url) => {
    expect(frameNavigationAllowed(url, false)).toBe(false);
  });

  it("L3 the main frame never navigates (constitution II, kept)", () => {
    expect(frameNavigationAllowed("https://www.youtube-nocookie.com/", true)).toBe(false);
    expect(frameNavigationAllowed("app://vesta/index.html", true)).toBe(false);
  });
});

type HeadersListener = (details: Record<string, unknown>, callback: (response: Record<string, unknown>) => void) => void;

/** The parts of an Electron session `applySessionSecurity` touches, recording what was installed. */
function sessionDouble(): { session: Session; calls: { headers: HeadersListener[]; before: number; spell: boolean[]; permRequest: number; permCheck: number } } {
  const calls = { headers: [] as HeadersListener[], before: 0, spell: [] as boolean[], permRequest: 0, permCheck: 0 };
  const session = {
    webRequest: {
      onHeadersReceived: (listener: HeadersListener) => {
        calls.headers.push(listener);
      },
      onBeforeRequest: () => {
        calls.before += 1;
      },
    },
    setSpellCheckerEnabled: (on: boolean) => {
      calls.spell.push(on);
    },
    setPermissionRequestHandler: () => {
      calls.permRequest += 1;
    },
    setPermissionCheckHandler: () => {
      calls.permCheck += 1;
    },
  } as unknown as Session;
  return { session, calls };
}

describe("L6 the development policy header (010 FR-020; convergence T090)", () => {
  const DEV = "http://localhost:5173";

  it("L6 the development policy header is installed only when a development server is set", () => {
    const packaged = sessionDouble();
    applySessionSecurity(packaged.session, { isPackaged: true, devOrigin: null });
    const unpackagedNoDev = sessionDouble();
    applySessionSecurity(unpackagedNoDev.session, { isPackaged: false, devOrigin: null });
    const packagedWithDev = sessionDouble(); // a packaged build never honors a development origin
    applySessionSecurity(packagedWithDev.session, { isPackaged: true, devOrigin: DEV });
    const dev = sessionDouble();
    applySessionSecurity(dev.session, { isPackaged: false, devOrigin: DEV });
    expect(packaged.calls.headers).toHaveLength(0);
    expect(unpackagedNoDev.calls.headers).toHaveLength(0);
    expect(packagedWithDev.calls.headers).toHaveLength(0);
    expect(dev.calls.headers).toHaveLength(1);
    // The rest of the session hardening is installed in every build (FR-031 controls kept).
    for (const d of [packaged, unpackagedNoDev, packagedWithDev, dev]) {
      expect(d.calls.before).toBe(1);
      expect(d.calls.spell).toEqual([false]);
      expect(d.calls.permRequest).toBe(1);
      expect(d.calls.permCheck).toBe(1);
    }
  });

  it("L6 the header goes on the development server's documents only; other responses pass through unchanged", () => {
    const dev = sessionDouble();
    applySessionSecurity(dev.session, { isPackaged: false, devOrigin: DEV });
    const listener = dev.calls.headers[0];
    if (listener === undefined) throw new Error("no header listener");
    const respond = (details: Record<string, unknown>): Record<string, unknown> | undefined => {
      let out: Record<string, unknown> | undefined;
      listener(details, (response) => {
        out = response;
      });
      return out;
    };
    const original = { "X-Test": ["1"] };
    const withPolicy = { responseHeaders: { "X-Test": ["1"], "Content-Security-Policy": [DEV_CSP(DEV)] } };
    expect(respond({ resourceType: "mainFrame", url: `${DEV}/index.html`, responseHeaders: original })).toEqual(withPolicy);
    expect(respond({ resourceType: "subFrame", url: `${DEV}/frame.html`, responseHeaders: original })).toEqual(withPolicy);
    expect(respond({ resourceType: "mainFrame", url: "https://www.youtube-nocookie.com/embed/x", responseHeaders: original })).toEqual({});
    expect(respond({ resourceType: "script", url: `${DEV}/main.js`, responseHeaders: original })).toEqual({});
    expect(respond({ resourceType: "mainFrame", url: "http://localhost:5174/index.html", responseHeaders: original })).toEqual({});
  });
});

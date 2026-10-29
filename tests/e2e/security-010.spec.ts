// 010 US4 (L13, L4, L5, L6, L3, I4, M2/L15): only Vesta's own page talks to Vesta. Page-facing proofs of the window
// boundary; the pure rules have unit tests (security.test.ts, app-protocol.test.ts, csp.test.ts).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { PRODUCTION_CSP } from "../../src/main/csp";
import { taskCard } from "./fixtures/alerts";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { addTasks, seedAsset, seedTasks, task } from "./fixtures/seed";

const UNTRUSTED = resolve(import.meta.dirname, "fixtures/untrusted.html");
const PRELOAD = resolve(import.meta.dirname, "../../out/preload/index.cjs");
const PLAYER = "https://www.youtube-nocookie.com/";

function logText(dataDir: string): string {
  return readdirSync(join(dataDir, "logs"))
    .map((f) => readFileSync(join(dataDir, "logs", f), "utf8"))
    .join("");
}

test.describe("010 US4 — only Vesta's own page talks to Vesta", () => {
  test("L13 the window is served from app://vesta/ and the scheme refuses everything outside the built page", async () => {
    const { app, page } = await launchVesta();
    try {
      expect(page.url().startsWith("app://vesta/")).toBe(true);
      const status = (url: string) => app.evaluate(({ net }, u) => net.fetch(u).then((r) => r.status), url);
      expect(await status("app://vesta/index.html")).toBe(200);
      expect(await status("app://vesta/../../etc/passwd")).toBe(404);
      expect(await status("app://vesta/%2F..%2F..%2Fetc%2Fpasswd")).toBe(404);
      expect(await status("app://other/index.html")).toBe(404);
      expect(await status("app://vesta/index.html.exe")).toBe(404);
    } finally {
      await app.close();
    }
  });

  test("L6 the document carries the production policy as a header, identical to the page's meta tag", async () => {
    const { app, page } = await launchVesta();
    try {
      const header = await app.evaluate(({ net }) => net.fetch("app://vesta/index.html").then((r) => r.headers.get("content-security-policy")));
      expect(header).toBe(PRODUCTION_CSP);
      const meta = await page.locator("meta[http-equiv='Content-Security-Policy']").getAttribute("content");
      expect(meta).toBe(PRODUCTION_CSP);
      expect(await app.evaluate(({ net }) => net.fetch("app://vesta/index.html").then((r) => r.headers.get("x-content-type-options")))).toBe("nosniff");
    } finally {
      await app.close();
    }
  });

  test("L4/L5/L3 a second window on file:// is refused on every channel, gets the guard, and its frame cannot leave", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app } = await launchVesta({ dataDir });
    try {
      const result = await app.evaluate(
        async ({ BrowserWindow }, { preload, file }) => {
          const win = new BrowserWindow({
            show: false,
            webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
          });
          await win.loadFile(file);
          const title = await new Promise<string>((done) => {
            const check = () => {
              const t = win.getTitle();
              if (t !== "untrusted") done(t);
              else setTimeout(check, 50);
            };
            check();
          });
          const frameBefore = win.webContents.mainFrame.frames[0]?.url ?? null;
          await win.webContents.executeJavaScript("document.getElementById('nav').click(); 'clicked'");
          await new Promise((r) => setTimeout(r, 500));
          const frameAfter = win.webContents.mainFrame.frames[0]?.url ?? null;
          const url = win.webContents.getURL();
          win.destroy();
          return { title, url, frameBefore, frameAfter };
        },
        { preload: PRELOAD, file: UNTRUSTED },
      );
      expect(result.url.startsWith("file://")).toBe(true);
      expect(result.title).toBe("INVALID");
      expect(result.frameBefore).toBe("about:blank");
      expect(result.frameAfter).toBe("about:blank");
      await expect.poll(() => logText(dataDir)).toContain('"ipc.untrusted-sender"');
      const log = logText(dataDir);
      expect(log).toMatch(/"ipc\.untrusted-sender"[^\n]*"scheme":"file"/);
      expect(log).not.toContain("untrusted.html");
      expect(log).toMatch(/"frame\.navigation-blocked"[^\n]*example\.com/);
    } finally {
      await app.close();
    }
  });

  test("M2/L15 a stored file is served as a sandboxed, uncached attachment; an unknown one is 404 with nosniff", async () => {
    const dataDir = freshDataDir();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
    const ref = seedAsset(dataDir, png, "png", "image/png");
    addTasks(dataDir, [task({ titleMd: `![i](${ref})` })]); // the asset seeding created the database
    const { app } = await launchVesta({ dataDir });
    try {
      const headers = (url: string) =>
        app.evaluate(({ net }, u) => net.fetch(u).then((r) => ({ status: r.status, headers: Object.fromEntries(r.headers.entries()) })), url);
      const served = await headers(`vesta-asset://${ref}`);
      expect(served.status).toBe(200);
      expect(served.headers).toMatchObject({
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "content-disposition": "attachment",
        "cache-control": "no-store",
      });
      const missing = await headers(`vesta-asset://assets/${createHash("sha256").update("nope").digest("hex")}.png`);
      expect(missing.status).toBe(404);
      expect(missing.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      await app.close();
    }
  });

  test("L2 the player is built from the link's id alone; a link that is no video address mounts no player", async () => {
    const dataDir = freshDataDir();
    const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLnotforplayer";
    const other = "https://vimeo.com/123456";
    seedTasks(dataDir, [task({ titleMd: "Video", detailsMd: `${video}\n\n[Elsewhere](${other})` })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Video").locator(".title").click();
      const details = page.getByRole("complementary", { name: "Details" }).getByRole("textbox", { name: "Details" });
      await expect(details).toBeVisible();
      const frames = details.locator("iframe");
      await expect(frames).toHaveCount(1);
      // Only the validated 11-character id reaches the player: no time, playlist or anything else from the stored link.
      await expect(frames.first()).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
      await expect(details.locator(`a[href="${other}"]`)).toHaveText("Elsewhere");
    } finally {
      await app.close();
    }
  });

  test("I4 the player's storage does not survive a quit", async () => {
    let run = await launchVesta();
    try {
      await run.app.evaluate(({ session }, url) => session.defaultSession.cookies.set({ url, name: "yt", value: "1" }), PLAYER);
      expect(await run.app.evaluate(({ session }, url) => session.defaultSession.cookies.get({ url }).then((c) => c.length), PLAYER)).toBe(1);
      run = await relaunch(run);
      expect(await run.app.evaluate(({ session }, url) => session.defaultSession.cookies.get({ url }).then((c) => c.length), PLAYER)).toBe(0);
    } finally {
      await run.app.close();
    }
  });
});

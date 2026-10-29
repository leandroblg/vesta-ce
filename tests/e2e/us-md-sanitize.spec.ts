// 005 US5, SC-004: nothing runs and nothing loads, wherever user text is rendered (quickstart scenario 14, T059).
import { expect, test, type Page } from "@playwright/test";
import { pasteHtml } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { expectOnly, recordRequests } from "./fixtures/network";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";

const P = "window.__pwned=1";
// Every forbidden construct of FR-035, FR-035a and FR-035b, each trying to set window.__pwned.
const DETAILS = [
  `<script>${P}</script>`,
  `<img src=x onerror="${P}">`,
  `<IMG SRC=x ONERROR="${P}">`,
  `<b OnClick="${P}">click me</b>`,
  `[js](javascript:${P}) [js2](JaVaScRiPt:${P}) [data](data:text/html,<script>${P}</script>) [vb](vbscript:msgbox)`,
  `<a href="javascript:${P}">anchor</a>`,
  `<p style="background:url(https://example.com/bg.png)">styled</p>`,
  `<style>body{background:url(https://example.com/s.png)}</style>`,
  `<form action="https://example.com"><input name="q"><button>go</button></form>`,
  `<object data="https://example.com/x.swf"></object><embed src="https://example.com/x.swf">`,
  `<svg onload="${P}"><circle r="5"/></svg><math><mi>x</mi></math>`,
  `<iframe src="https://example.com/frame"></iframe>`,
  `<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>`,
  "![remote](https://example.com/a.png)",
  "![traversal](assets/../data.sqlite) [traversal](assets/../data.sqlite)",
  // Allowed markup that must still render.
  "**bold**",
  "<details><summary>More</summary>\n\nhidden body\n\n</details>",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
].join("\n\n");
const TITLE = `<b>html</b> <img src=x onerror="${P}"> [js](javascript:${P}) ![r](https://example.com/t.png)`;

const pwned = (page: Page) => page.evaluate(() => (window as unknown as { __pwned?: unknown }).__pwned);
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

async function clickAll(page: Page, selector: string): Promise<void> {
  for (const el of await page.locator(selector).all())
    await el.click({ force: true, modifiers: ["ControlOrMeta"] }).catch(() => undefined);
}

test.describe("005 US5 — sanitization (SC-004)", () => {
  test("cards, the panel editors, the Archive and the Trash run nothing and load nothing", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [
      task({ titleMd: TITLE, detailsMd: DETAILS, position: 1 }),
      task({ titleMd: `Done ${TITLE}`, detailsMd: DETAILS, doneAt: now - 1000, position: 2 }),
      task({ titleMd: `Trashed ${TITLE}`, detailsMd: DETAILS, deletedAt: now - 1000, position: 3 }),
    ]);
    seedReminders(dataDir, [reminder({ textMd: TITLE })]);
    const { app, page } = await launchVesta({ dataDir });
    const requests = recordRequests(page);
    try {
      // Cards: HTML in a title or reminder is text (FR-035b); links with refused schemes are text.
      const title = page.locator("li[data-kind='task'] .title").first();
      await expect(title).toContainText("<b>html</b>");
      await expect(title.locator("b, img, script")).toHaveCount(0);
      await expect(title.locator("a")).toHaveCount(0);
      await expect(page.locator("li[data-kind='rem'] .title").first()).toContainText("<b>html</b>");

      // The panel's editors.
      await title.click();
      const details = panel(page).getByRole("textbox", { name: "Details" });
      await expect(details).toBeVisible();
      await expect(details.locator("strong")).toHaveText("bold");
      await expect(details.locator("table td").first()).toHaveText("1");
      // An inline tag pair shows as its source in the editor (one tag cannot render alone); nothing runs.
      await expect(details.locator("span[data-type='html'][data-source]").first()).toBeVisible();
      await expect(details.locator("script, svg, math, form, input, object, embed, style")).toHaveCount(0);
      await expect(details.locator("[onerror], [onclick], [onload], [style*='url']")).toHaveCount(0);
      const frames = await details.locator("iframe").evaluateAll((els) => els.map((e) => e.getAttribute("src")));
      expect(frames).toEqual(["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"]);
      await expect(
        details.locator("[data-md-placeholder='remote-image']", { hasText: "https://example.com/a.png" }),
      ).toBeVisible();
      await clickAll(page, ".md-block a");
      await panel(page).getByRole("textbox", { name: "Title" }).click();
      await expect(panel(page).getByRole("textbox", { name: "Title" }).locator("b, img")).toHaveCount(0);
      await page.keyboard.press("Escape");

      // The Archive and the Trash.
      await page.getByRole("button", { name: /^Archive/ }).click();
      await expect(page.locator("li.arow").first()).toContainText("<b>html</b>");
      await expect(page.locator("li.arow b, li.arow img, li.arow a")).toHaveCount(0);
      await page.getByRole("button", { name: /^Trash/ }).click();
      await expect(page.locator("main")).toContainText("Trashed <b>html</b>");
      await expect(page.locator("main li b, main li img, main li a")).toHaveCount(0);

      // A traversal through the asset protocol answers 404 and loads nothing.
      const traversal = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const img = new Image();
            img.onload = () => {
              resolve(img.naturalWidth);
            };
            img.onerror = () => {
              resolve(-1);
            };
            img.src = "vesta-asset://assets/../data.sqlite";
          }),
      );
      expect(traversal).toBe(-1);

      expect(await pwned(page)).toBeUndefined();
      expectOnly(requests, ["www.youtube-nocookie.com"]);
    } finally {
      await app.close();
    }
  });

  test("pasted HTML is sanitized before it reaches the editor; the runbook's onerror check runs nothing", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Paste here" })]);
    const { app, page } = await launchVesta({ dataDir });
    const requests = recordRequests(page);
    try {
      await page.locator("li[data-kind='task'] .title").click();
      const details = panel(page).getByRole("textbox", { name: "Details" });
      await details.click({ position: { x: 4, y: 4 } });
      await pasteHtml(
        details,
        `<b>kept</b><img src=x onerror="${P}"><script>${P}</script><a href="javascript:${P}">bad</a><iframe src="https://example.com/x"></iframe><details><summary>S</summary>body</details>`,
        "",
      );
      await expect(details.locator("strong, b").first()).toHaveText("kept");
      await expect(details.locator("img:not(.ProseMirror-separator), script, iframe")).toHaveCount(0);
      await page.waitForTimeout(300);
      expect(await pwned(page)).toBeUndefined();
      expectOnly(requests, ["www.youtube-nocookie.com"]);
    } finally {
      await app.close();
    }
  });
});

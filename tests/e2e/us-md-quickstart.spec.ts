// The runbook's card 005 step L hand checks, automated (quickstart scenario 18, T066). Nothing is run by hand.
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { caretAtEnd, dropFile, dropLargeFile, menu, pasteHtml, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { goOffline, recordRequests, expectOnly } from "./fixtures/network";
import { seedAsset, seedTasks, task } from "./fixtures/seed";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC",
  "base64",
);
const IMAGE = `assets/${createHash("sha256").update(PNG).digest("hex")}.png`;
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });

// Every row of the PRD A5 Formatting table: the title column in the title, the details column in the details.
const TITLE = `**b** *i* \`c\` [l](https://example.com) ~~s~~ [u]{.underline} [col]{color="#dd3333ff"} ==h== [bg]{bg="#ffe066ff"} [sz]{size="1.5em"} 🎉 ![p](${IMAGE})`;
const DETAILS = [
  "## Heading",
  `**b** *i* \`c\` [l](https://example.com) ~~s~~ [u]{.underline} [col]{color="#dd3333ff"} ==h== 🎉 line\\\nbreak`,
  "---",
  "- item\n  - nested\n\n1. one",
  "> quote",
  "| a | b |\n| --- | --- |\n| 1   | 2   |",
  "- [ ] open\n- [x] done",
  `![p](${IMAGE}) [file](${IMAGE})`,
  "```js\nconst a = 1;\n```",
  "<details><summary>More</summary>\n\nhidden\n\n</details>",
  "Note[^1]\n\n[^1]: the footnote",
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "a <b>html</b> c",
].join("\n\n");

const TITLE_SHOWS = [
  "strong",
  "em",
  "code",
  "a",
  "del",
  "[data-underline]",
  "[data-color]",
  "mark",
  "[data-bg]",
  "[data-size]",
  "img",
];
const DETAILS_SHOWS = [
  "h2",
  "strong",
  "hr",
  "ul ul",
  "ol",
  "blockquote",
  "table td",
  "li[data-item-type='task']",
  "img",
  "pre",
  "sup",
  "br",
];

test.describe("runbook 005 step L, automated", () => {
  test("every Formatting row renders in the list and in the panel, and survives a restart", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: TITLE, detailsMd: DETAILS });
    seedTasks(dataDir, [a]);
    seedAsset(dataDir, PNG, "png", "image/png");
    let run = await launchVesta({ dataDir });
    try {
      for (let pass = 0; pass < 2; pass++) {
        const title = run.page.locator("li[data-kind='task'] .title").first();
        for (const selector of TITLE_SHOWS)
          await expect(title.locator(selector).first(), `list: ${selector}`).toBeAttached();
        await expect(title).toContainText("🎉");
        await title.click();
        for (const selector of DETAILS_SHOWS)
          await expect(details(run.page).locator(selector).first(), `panel: ${selector}`).toBeAttached();
        for (const selector of TITLE_SHOWS)
          await expect(
            panel(run.page).getByRole("textbox", { name: "Title" }).locator(selector).first(),
            `panel title: ${selector}`,
          ).toBeAttached();
        await run.page.keyboard.press("Escape");
        await run.page.waitForTimeout(700);
        expect(readTask(dataDir, a.id)?.title_md).toBe(TITLE);
        expect(readTask(dataDir, a.id)?.details_md).toBe(DETAILS);
        if (pass === 0) run = await relaunch(run);
      }
    } finally {
      await run.app.close();
    }
  });

  test("a selection gets the menu above it; with nothing selected the menu formats the whole field", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "one two" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "one two").locator(".title").dblclick();
      const editor = page.locator("li[data-kind='task'] .ProseMirror");
      await selectText(editor, "two");
      await expect(menu(page).locator(".fm-scope")).toHaveText("Selection");
      await menu(page).getByRole("button", { name: "Bold" }).click();
      await page.keyboard.press("End");
      await expect(menu(page).locator(".fm-scope")).toHaveText("Whole title");
      await menu(page).getByRole("button", { name: "Italic" }).click();
      await page.keyboard.press("Enter");
      await expect.poll(() => readTask(dataDir, a.id)?.title_md).toBe("*one **two***");
    } finally {
      await app.close();
    }
  });

  test("the panel shows Saved in green for 3 s after typing stops; closing and reopening shows the edit", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Saved check" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Saved check").locator(".title").click();
      await caretAtEnd(details(page));
      await page.keyboard.type("typed text");
      const saved = panel(page).locator(".saved");
      await expect(saved).toHaveText("Saved");
      // Green: the theme's --ok color.
      const green = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ok)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      await expect(saved).toHaveCSS("color", green);
      await page.waitForTimeout(2500);
      await expect(saved).toHaveText("Saved");
      await expect(saved).toHaveText("", { timeout: 1500 });
      await page.keyboard.press("Escape");
      await taskCard(page, "Saved check").locator(".title").click();
      await expect(details(page)).toHaveText("typed text");
    } finally {
      await app.close();
    }
  });

  test("a file over 100 MB is refused with a message; a smaller one still shows after the original is deleted", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Files check" })]);
    const src = mkdtempSync(join(tmpdir(), "vesta-step-l-"));
    writeFileSync(join(src, "small.png"), PNG);
    let run = await launchVesta({ dataDir });
    try {
      await taskCard(run.page, "Files check").locator(".title").click();
      await caretAtEnd(details(run.page));
      await dropLargeFile(details(run.page), "big.mov", 101 * 1024 * 1024);
      await expect(run.page.getByRole("alert")).toHaveText("“big.mov” is larger than 100 MB and was not added.");
      await dropFile(details(run.page), join(src, "small.png"), "image/png");
      await expect(panel(run.page).locator(".saved")).toHaveText("Saved");
      rmSync(src, { recursive: true, force: true });
      run = await relaunch(run);
      await taskCard(run.page, "Files check").locator(".title").click();
      const img = details(run.page).locator("img:not(.ProseMirror-separator)");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(4);
    } finally {
      await run.app.close();
      rmSync(src, { recursive: true, force: true });
    }
  });

  test("with the network off, a YouTube embed shows a placeholder with the link", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Video check", detailsMd: "https://youtu.be/dQw4w9WgXcQ" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await goOffline(page);
      await taskCard(page, "Video check").locator(".title").click();
      const placeholder = details(page).locator("[data-yt-offline]");
      await expect(placeholder).toContainText("YouTube video (offline):");
      await expect(placeholder.locator("a")).toHaveAttribute("href", "https://youtu.be/dQw4w9WgXcQ");
    } finally {
      await app.close();
    }
  });

  test("pasting <img src=x onerror=alert(1)> into the details runs nothing", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Paste check" })]);
    const { app, page } = await launchVesta({ dataDir });
    const requests = recordRequests(page);
    try {
      await page.evaluate(() => {
        window.alert = () => {
          (window as unknown as { __alerted: boolean }).__alerted = true;
        };
      });
      await taskCard(page, "Paste check").locator(".title").click();
      await caretAtEnd(details(page));
      await pasteHtml(details(page), "<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>");
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as unknown as { __alerted?: boolean }).__alerted)).toBeUndefined();
      expectOnly(requests, ["www.youtube-nocookie.com"]);
    } finally {
      await app.close();
    }
  });
});

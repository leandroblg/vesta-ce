// 012 US1: with nothing selected in the details, the menu acts on the block holding the cursor and its label
// names it (quickstart scenarios 1 and 2, tasks T016).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedSetting, seedTasks, task } from "./fixtures/seed";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const label = (page: Page) => menu(page).locator(".fm-scope");
const button = (page: Page, cmd: string) => menu(page).locator(`button[data-cmd="${cmd}"]`);

const DOC = ["# Heading", "Plain paragraph", "- list item", "> quoted text", "```\ncode text\n```", "| head |\n| --- |\n| cell text |"].join(
  "\n\n",
);

async function launch(detailsMd: string, language?: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Scope", detailsMd });
  seedTasks(dataDir, [a]);
  if (language !== undefined) seedSetting(dataDir, "language", language);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

async function openDetails(page: Page): Promise<Locator> {
  await card(page).locator(".title").click();
  const editor = details(page);
  await editor.click();
  return editor;
}

/** Puts the caret inside `text`, through the DOM selection ProseMirror follows. */
async function caretIn(editor: Locator, text: string): Promise<void> {
  await editor.evaluate((root: HTMLElement, wanted) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + 1);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error(`text not found: ${wanted}`);
  }, text);
}

const POSITIONS: [string, string][] = [
  ["Heading", "fmScope_heading"],
  ["Plain", "fmScope_paragraph"],
  ["list item", "fmScope_listItem"],
  ["quoted", "fmScope_quote"],
  ["code text", "fmScope_code"],
  ["cell text", "fmScope_cell"],
];

const locale = (lang: string): Record<string, string> =>
  JSON.parse(readFileSync(join(import.meta.dirname, "../../src/shared/i18n/locales", `${lang}.json`), "utf8")) as Record<string, string>;

test.describe("012 US1 — the menu's scope", () => {
  test("FR-001 FR-002 the label names each block, and Bold changes only the cursor's block", async () => {
    const { app, page, dataDir, id } = await launch(DOC);
    try {
      const editor = await openDetails(page);
      const en = locale("en");
      for (const [text, key] of POSITIONS) {
        await caretIn(editor, text);
        await expect(label(page), text).toHaveText(en[key] as string);
      }
      await caretIn(editor, "Plain");
      await button(page, "strong").click();
      await expect.poll(() => readTask(dataDir, id)?.details_md).toContain("**Plain paragraph**");
      expect(readTask(dataDir, id)?.details_md).toContain("- list item");
      // A partial selection, then Select All.
      await page.keyboard.press("Shift+ArrowRight");
      await expect(label(page)).toHaveText("Selection");
      await editor.focus();
      await page.keyboard.press("ControlOrMeta+a");
      await expect(label(page)).toHaveText("All details");
    } finally {
      await app.close();
    }
  });

  test("FR-002b inline options are unavailable in a code block; block options stay", async () => {
    const { app, page } = await launch(DOC);
    try {
      const editor = await openDetails(page);
      await caretIn(editor, "code text");
      for (const cmd of ["strong", "emphasis", "mark", "color", "link"])
        await expect(button(page, cmd), cmd).toHaveAttribute("aria-disabled", "true");
      await expect(button(page, "codeblock")).not.toHaveAttribute("aria-disabled", "true");
    } finally {
      await app.close();
    }
  });

  test("FR-004 the toolbar is described by the label", async () => {
    const { app, page } = await launch(DOC);
    try {
      const editor = await openDetails(page);
      await caretIn(editor, "list item");
      await expect(menu(page)).toHaveAccessibleDescription("List item");
    } finally {
      await app.close();
    }
  });

  test("FR-003 the title keeps its whole-scope label", async () => {
    const { app, page } = await launch("text");
    try {
      await card(page).locator(".title").click();
      await panel(page).getByRole("textbox", { name: "Title" }).click();
      await expect(label(page)).toHaveText("Whole title");
    } finally {
      await app.close();
    }
  });

  for (const lang of ["pt-BR", "it", "es-ES", "fr"]) {
    test(`SC-002 the labels in ${lang}`, async () => {
      const { app, page } = await launch(DOC, lang);
      try {
        const strings = locale(lang);
        await card(page).locator(".title").click();
        // The panel's name is localized: found by its element here.
        const editor = page.locator("aside.panel .md-editor [contenteditable='true']");
        await editor.click();
        for (const [text, key] of POSITIONS) {
          await caretIn(editor, text);
          await expect(page.locator(".fmenu:not([hidden]) .fm-scope"), `${lang} ${text}`).toHaveText(strings[key] as string);
        }
        await page.keyboard.press("ControlOrMeta+a");
        await expect(page.locator(".fmenu:not([hidden]) .fm-scope")).toHaveText(strings["fmAll_details"] as string);
      } finally {
        await app.close();
      }
    });
  }
});

// 011 US1: every format button turns its format off again (quickstart scenarios 1 to 4, tasks T034).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { MOD } from "./fixtures/settings";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });

async function launch(title: string, detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: title, detailsMd });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

/** Selects from the start of `a` to the end of `b`, across blocks, through the DOM selection ProseMirror follows. */
async function selectAcross(editor: Locator, a: string, b: string): Promise<void> {
  await editor.evaluate(
    (root: HTMLElement, [first, last]) => {
      root.focus();
      const find = (wanted: string) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(wanted) ?? -1;
          if (at >= 0) return { node, at };
        }
        throw new Error(`text not found: ${wanted}`);
      };
      const start = find(first);
      const end = find(last);
      const range = document.createRange();
      range.setStart(start.node, start.at);
      range.setEnd(end.node, end.at + last.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    [a, b] as const,
  );
}

async function openDetails(page: Page): Promise<Locator> {
  await card(page).locator(".title").click();
  const editor = details(page);
  await editor.click();
  return editor;
}

async function stored(page: Page, dataDir: string, id: string, expected: string): Promise<void> {
  await expect.poll(() => readTask(dataDir, id)?.details_md, { message: expected }).toBe(expected);
  await expect(panel(page).locator(".saved")).toHaveText("Saved");
}

const button = (page: Page, name: string) => menu(page).getByRole("button", { name, exact: true });

test.describe("011 US1 — toggles", () => {
  test("SC-001 FR-006 each block toggle applied and pressed again returns the original markdown", async () => {
    const { app, page, dataDir, id } = await launch("Toggles", "alpha\n\nbeta");
    try {
      const editor = await openDetails(page);
      for (const name of ["Bulleted list", "Numbered list", "Quote", "Code block"]) {
        await selectAcross(editor, "alpha", "beta");
        await expect(button(page, name), name).toHaveAttribute("aria-pressed", "false");
        await button(page, name).click();
        await expect(button(page, name), name).toHaveAttribute("aria-pressed", "true");
        await selectAcross(editor, "alpha", "beta");
        await button(page, name).click();
        await expect(button(page, name), name).toHaveAttribute("aria-pressed", "false");
      }
      await stored(page, dataDir, id, "alpha\n\nbeta");
    } finally {
      await app.close();
    }
  });

  test("FR-001 Highlight removes a highlight color from a title selection", async () => {
    const { app, page, dataDir, id } = await launch('[Renew]{bg="#ffe066ff"} passport', "");
    try {
      await card(page).locator(".title").dblclick();
      const editor = card(page).locator(".ProseMirror");
      await selectText(editor, "Renew");
      await expect(button(page, "Highlight")).toHaveAttribute("aria-pressed", "true");
      await button(page, "Highlight").click();
      await page.keyboard.press("Enter");
      await expect.poll(() => readTask(dataDir, id)?.title_md).toBe("Renew passport");
    } finally {
      await app.close();
    }
  });

  test("FR-003 Bulleted list on a numbered list switches it in place; FR-004 FR-005 quote nesting by key and unquoting", async () => {
    const { app, page, dataDir, id } = await launch("Lists", "1. one\n2. two");
    try {
      const editor = await openDetails(page);
      await selectAcross(editor, "one", "two");
      await button(page, "Bulleted list").click();
      await stored(page, dataDir, id, "- one\n- two");

      await selectAcross(editor, "one", "two");
      await button(page, "Bulleted list").click();
      await stored(page, dataDir, id, "one\n\ntwo");

      await selectText(editor, "two");
      await page.keyboard.press(`${MOD}+'`);
      await page.keyboard.press(`${MOD}+'`);
      await stored(page, dataDir, id, "one\n\n> > two");
      await selectText(editor, "two");
      await button(page, "Quote").click();
      await stored(page, dataDir, id, "one\n\n> two");
    } finally {
      await app.close();
    }
  });

  test("FR-002a Shift+click on Code block merges the selection with the code blocks around it", async () => {
    const { app, page, dataDir, id } = await launch("Code", "```\nx\n```\n\nmiddle\n\n```\ny\n```");
    try {
      const editor = await openDetails(page);
      await selectText(editor, "middle");
      await button(page, "Code block").click({ modifiers: ["Shift"] });
      await stored(page, dataDir, id, "```\nx\nmiddle\ny\n```");
    } finally {
      await app.close();
    }
  });
});

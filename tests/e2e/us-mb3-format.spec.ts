// 013 US3 (spec scenarios 1–7; quickstart row 6): the Format menu offers what the floating menu offers in the
// current scope, checks the pressed formats, and runs the button's action.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { colorPicker, menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, menuItem, waitMenuState } from "./fixtures/menu";
import { seedTasks, task } from "./fixtures/seed";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });

async function launch(detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Format", detailsMd });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

async function openDetails(page: Page): Promise<Locator> {
  await card(page).locator(".title").click();
  const editor = details(page);
  await editor.click();
  return editor;
}

/** Selects from the start of `a` to the end of `b`, or puts the caret inside `a`. */
async function select(editor: Locator, a: string, b?: string | null): Promise<void> {
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
      const range = document.createRange();
      if (last === null) {
        range.setStart(start.node, start.at + 1);
        range.collapse(true);
      } else {
        const end = find(last);
        range.setStart(start.node, start.at);
        range.setEnd(end.node, end.at + last.length);
      }
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    [a, b ?? null] as const,
  );
}

const stored = (dataDir: string, id: string) => readTask(dataDir, id)?.details_md;

test.describe("013 US3 — format from the menu bar", () => {
  test("US3-1 US3-2 nothing edited disables Format; a title offers only its options", async () => {
    const { app, page } = await launch("text");
    try {
      for (const id of ["fmt:strong", "fmt:bullet", "fmt:table", "fmt:link"]) await waitMenuState(app, id, { enabled: false });
      await card(page).locator(".title").dblclick();
      await waitMenuState(app, "fmt:strong", { enabled: true });
      for (const id of ["fmt:bullet", "fmt:ordered", "fmt:check", "fmt:indent", "fmt:quote", "fmt:codeblock", "fmt:hr", "fmt:table"])
        expect((await menuItem(app, id)).enabled, id).toBe(false);
    } finally {
      await app.close();
    }
  });

  test("US3-3 Bold is checked on a bold selection and not on a partly bold one; US3-6 Bold from the menu equals the button", async () => {
    const { app, page, dataDir, id } = await launch("**bold** plain");
    try {
      const editor = await openDetails(page);
      await select(editor, "bold", "bold");
      await waitMenuState(app, "fmt:strong", { enabled: true, checked: true });
      await select(editor, "bold", "plain");
      await waitMenuState(app, "fmt:strong", { checked: false });
      await select(editor, "plain", "plain");
      await clickMenu(app, "fmt:strong");
      await expect.poll(() => stored(dataDir, id)).toBe("**bold** **plain**");
      await select(editor, "plain", "plain");
      await clickMenu(app, "fmt:bullet");
      await expect.poll(() => stored(dataDir, id)).toBe("- **bold** **plain**");
    } finally {
      await app.close();
    }
  });

  test("US3-4 the Table submenu follows the cursor; Remove Row is disabled on the header row", async () => {
    const { app, page } = await launch("before\n\n| a | b |\n| - | - |\n| c | d |");
    try {
      const editor = await openDetails(page);
      await select(editor, "before");
      await waitMenuState(app, "fmt:table", { enabled: true });
      for (const id of ["fmt:row-above", "fmt:row-delete", "fmt:table-delete"]) expect((await menuItem(app, id)).enabled, id).toBe(false);
      await select(editor, "a");
      await waitMenuState(app, "fmt:row-below", { enabled: true });
      expect((await menuItem(app, "fmt:table")).enabled).toBe(false);
      expect((await menuItem(app, "fmt:row-delete")).enabled).toBe(false);
      expect((await menuItem(app, "fmt:table-delete")).enabled).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("US3-5 Highlight Color… opens the picker at the floating menu; US3-7 Heading › Heading 2 is checked in an H2", async () => {
    const { app, page, dataDir, id } = await launch("## Two\n\npara");
    try {
      const editor = await openDetails(page);
      await select(editor, "Two");
      await waitMenuState(app, "fmt:heading-2", { checked: true });
      await select(editor, "para");
      await waitMenuState(app, "fmt:heading-0", { checked: true });
      await clickMenu(app, "fmt:heading-1");
      await expect.poll(() => stored(dataDir, id)).toBe("## Two\n\n# para");
      await select(editor, "para", "para");
      await clickMenu(app, "fmt:bg");
      await expect(colorPicker(page)).toBeVisible();
      await expect(menu(page)).toBeVisible();
    } finally {
      await app.close();
    }
  });
});

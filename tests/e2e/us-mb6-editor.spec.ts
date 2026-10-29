// 013 US6 (spec scenarios 1–10; quickstart rows 11–14): one Highlight button, one list item per paragraph, Indent on
// a list made with the buttons, and the long press that never closes anything when released.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { colorPicker, menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { MOD, capture, closeSettings } from "./fixtures/settings";

const card = (page: Page, title = "Edit") =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const button = (page: Page, cmd: string) => menu(page).locator(`button[data-cmd="${cmd}"]`);
const sizeGrid = (page: Page) => page.locator(".tsize:not([hidden])");

async function launch(detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Edit", detailsMd, position: 1 });
  seedTasks(dataDir, [a, task({ titleMd: "Other", position: 2 })]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

async function openDetails(page: Page): Promise<Locator> {
  await card(page).locator(".title").click();
  const editor = details(page);
  await editor.click();
  return editor;
}

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

/** A click inside the details panel, near its bottom-left corner, away from any popover over the editor. */
async function clickInPanel(page: Page) {
  const box = await panel(page).boundingBox();
  if (box === null) throw new Error("no box");
  await page.mouse.click(box.x + 12, box.y + box.height - 12);
}

/** Holds the primary button on `from` for 600 ms, moves the pointer to `to` and releases it there. */
async function holdAndRelease(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error("no box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  await page.mouse.up();
}

test.describe("013 US6 — floating menu: Highlight, lists, Indent, long press", () => {
  test("US6-1 US6-2 US6-3 one Highlight button: a click highlights, a long press and Shift+Enter open the picker", async () => {
    const { app, page, dataDir, id } = await launch("word here");
    try {
      const editor = await openDetails(page);
      await expect(menu(page).getByRole("button", { name: "Highlight color", exact: true })).toHaveCount(0);
      await select(editor, "word", "word");
      await button(page, "mark").click();
      await expect.poll(() => stored(dataDir, id)).toBe("==word== here");
      await button(page, "mark").click();
      await expect.poll(() => stored(dataDir, id)).toBe("word here");
      await select(editor, "here", "here");
      const box = await button(page, "mark").boundingBox();
      if (box === null) throw new Error("no box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      await expect(colorPicker(page)).toBeVisible();
      await expect(colorPicker(page)).toHaveAttribute("aria-label", "Highlight color");
      expect(stored(dataDir, id)).toBe("word here");
      await page.keyboard.press("Escape");
      await button(page, "mark").focus();
      await page.keyboard.press("Shift+Enter");
      await expect(colorPicker(page)).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("US6-4 two paragraphs make one list of two items, bulleted or numbered; a heading stays and splits the list (Q179)", async () => {
    const { app, page, dataDir, id } = await launch("one\n\ntwo\n\n## head\n\nthree");
    try {
      const editor = await openDetails(page);
      await select(editor, "one", "two");
      await button(page, "bullet").click();
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two\n\n## head\n\nthree");
      await select(editor, "one", "two");
      await button(page, "ordered").click();
      await expect.poll(() => stored(dataDir, id)).toBe("1. one\n2. two\n\n## head\n\nthree");
      await select(editor, "one", "three");
      await button(page, "bullet").click();
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two\n\n## head\n\n- three");
    } finally {
      await app.close();
    }
  });

  test("US6-5 to US6-8 Indent on a list made with the button: button, Shift+click, Shift+Enter, Cmd/Ctrl+] and [, a remapped key; disabled on a first item and outside a list", async () => {
    const { app, page, dataDir, id } = await launch("one\n\ntwo\n\nplain");
    try {
      const editor = await openDetails(page);
      await select(editor, "one", "two");
      await button(page, "bullet").click();
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two\n\nplain");
      await select(editor, "one");
      await expect(button(page, "indent")).toHaveAttribute("aria-disabled", "true");
      await select(editor, "plain");
      await expect(button(page, "indent")).toHaveAttribute("aria-disabled", "true");
      await select(editor, "two");
      await button(page, "indent").click();
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n  - two\n\nplain");
      await select(editor, "two");
      // Indent is aria-disabled on a nested first item, but Shift+click still outdents (012 FR-007).
      await button(page, "indent").click({ modifiers: ["Shift"], force: true });
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two\n\nplain");
      await select(editor, "two");
      await page.keyboard.press(`${MOD}+BracketRight`);
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n  - two\n\nplain");
      await button(page, "indent").focus();
      await page.keyboard.press("Shift+Enter");
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two\n\nplain");
      await page.keyboard.press(`${MOD}+BracketRight`);
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n  - two\n\nplain");
      await page.keyboard.press(`${MOD}+BracketLeft`);
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two\n\nplain");
    } finally {
      await app.close();
    }
    const remap = await launch("one\n\ntwo");
    try {
      await capture(remap.page, "Indent", "Alt+ArrowRight");
      await closeSettings(remap.page);
      const editor = await openDetails(remap.page);
      await select(editor, "one", "two");
      await button(remap.page, "bullet").click();
      await select(editor, "two");
      await remap.page.keyboard.press("Alt+ArrowRight");
      await expect.poll(() => stored(remap.dataDir, remap.id)).toBe("- one\n  - two");
    } finally {
      await remap.app.close();
    }
  });

  test("US6-9 US6-10 a long press on Table or Highlight released over the list or the toolbar keeps the grid or picker and the panel open; a later click outside closes them", async () => {
    const { app, page } = await launch("text");
    try {
      const editor = await openDetails(page);
      await select(editor, "text");
      await holdAndRelease(page, button(page, "table"), card(page, "Other"));
      await expect(sizeGrid(page)).toBeVisible();
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await select(editor, "text");
      await holdAndRelease(page, button(page, "table"), page.locator("header .brand"));
      await expect(sizeGrid(page)).toBeVisible();
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await select(editor, "text", "text");
      await holdAndRelease(page, button(page, "mark"), card(page, "Other"));
      await expect(colorPicker(page)).toBeVisible();
      await expect(panel(page)).toBeVisible();
      // US6-10: a later click outside closes the picker, as it closes any popover (here in the details, so the panel stays).
      await clickInPanel(page);
      await expect(colorPicker(page)).toBeHidden();
      // And the size grid the same way.
      await select(editor, "text");
      await holdAndRelease(page, button(page, "table"), card(page, "Other"));
      await expect(sizeGrid(page)).toBeVisible();
      await clickInPanel(page);
      await expect(sizeGrid(page)).toBeHidden();
      await card(page, "Other").locator(".title").click({ position: { x: 2, y: 2 } });
      await page.mouse.click(5, 400);
      await expect(panel(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });
});

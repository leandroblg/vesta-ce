// 012 US3: checklists and nested lists from the menu and the keys (quickstart scenarios 5 and 6, tasks T046).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { capture, closeSettings } from "./fixtures/settings";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const button = (page: Page, cmd: string) => menu(page).locator(`button[data-cmd="${cmd}"]`);

async function launch(detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Lists", detailsMd });
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

/** Selects from the start of `a` to the end of `b` (or puts the caret inside `a`), through the DOM selection. */
async function select(editor: Locator, a: string, b?: string): Promise<void> {
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

test.describe("012 US3 — checklists and nested lists", () => {
  test("FR-010 FR-011 Checklist on two paragraphs, twice; on a nested numbered list, twice (016 FR-025 off)", async () => {
    const { app, page, dataDir, id } = await launch("alpha\n\nbeta");
    try {
      const editor = await openDetails(page);
      await select(editor, "alpha", "beta");
      await expect(button(page, "check")).toHaveAttribute("aria-pressed", "false");
      await button(page, "check").click();
      await expect.poll(() => stored(dataDir, id)).toBe("- [ ] alpha\n- [ ] beta");
      await select(editor, "alpha", "beta");
      await expect(button(page, "check")).toHaveAttribute("aria-pressed", "true");
      await button(page, "check").click();
      // 016 FR-025 (Q231): the whole of a stand-alone list gives the paragraphs back.
      await expect.poll(() => stored(dataDir, id)).toBe("alpha\n\nbeta");
    } finally {
      await app.close();
    }
    const nested = "1. one\n   - inner\n2. two";
    const run = await launch(nested);
    try {
      const editor = await openDetails(run.page);
      await select(editor, "one", "two");
      await button(run.page, "check").click();
      await expect.poll(() => stored(run.dataDir, run.id)).toBe("1. [ ] one\n   - [ ] inner\n2. [ ] two");
      await select(editor, "one", "two");
      await button(run.page, "check").click();
      // 016 FR-025: the outer list, all of it and alone, becomes paragraphs; the nested one stays a list.
      await expect.poll(() => stored(run.dataDir, run.id)).toBe("one\n\n- inner\n\ntwo");
    } finally {
      await run.app.close();
    }
  });

  test("FR-006 FR-007 Indent, Shift+click and Shift+Enter outdent; FR-008 disabled outside a list", async () => {
    const { app, page, dataDir, id } = await launch("plain\n\n- one\n- two\n- three");
    try {
      const editor = await openDetails(page);
      await select(editor, "plain");
      await expect(button(page, "indent")).toHaveAttribute("aria-disabled", "true");
      await select(editor, "two", "three");
      await button(page, "indent").click();
      await expect.poll(() => stored(dataDir, id)).toBe("plain\n\n- one\n  - two\n  - three");
      await select(editor, "two", "three");
      await button(page, "indent").click({ modifiers: ["Shift"] });
      await expect.poll(() => stored(dataDir, id)).toBe("plain\n\n- one\n- two\n- three");
      await select(editor, "three");
      await button(page, "indent").click();
      await expect.poll(() => stored(dataDir, id)).toBe("plain\n\n- one\n- two\n  - three");
      await button(page, "indent").focus();
      await page.keyboard.press("Shift+Enter");
      await expect.poll(() => stored(dataDir, id)).toBe("plain\n\n- one\n- two\n- three");
    } finally {
      await app.close();
    }
  });

  test("FR-009 Cmd/Ctrl+] and [ indent and outdent; Tab moves the focus out of the editor from inside a list", async () => {
    const { app, page, dataDir, id } = await launch("- one\n- two");
    try {
      const editor = await openDetails(page);
      await select(editor, "two");
      await page.keyboard.press("ControlOrMeta+]");
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n  - two");
      await page.keyboard.press("ControlOrMeta+[");
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n- two");
      await select(editor, "two");
      await page.keyboard.press("Tab");
      expect(await editor.evaluate((root) => root.contains(document.activeElement))).toBe(false);
      expect(stored(dataDir, id)).toBe("- one\n- two");
    } finally {
      await app.close();
    }
  });

  test("FR-009 the indent key can be remapped; the new combination works and the default no longer does", async () => {
    const { app, page, dataDir, id } = await launch("- one\n- two");
    try {
      await capture(page, "Indent", "Alt+ArrowRight");
      await closeSettings(page);
      const editor = await openDetails(page);
      await select(editor, "two");
      await page.keyboard.press("ControlOrMeta+]");
      await page.waitForTimeout(700);
      expect(stored(dataDir, id)).toBe("- one\n- two");
      await page.keyboard.press("Alt+ArrowRight");
      await expect.poll(() => stored(dataDir, id)).toBe("- one\n  - two");
    } finally {
      await app.close();
    }
  });
});

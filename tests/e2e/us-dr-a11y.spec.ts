// 012 accessibility (quickstart scenario 12, tasks T070): SC-005 and the FR-033a button table, in light and dark.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures/axe";
import { colorPicker, menu, openHighlightPicker, openTextColorPicker } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const button = (page: Page, cmd: string) => menu(page).locator(`button[data-cmd="${cmd}"]`);

const DOC = ["Plain paragraph", "- one\n- two", "```\ncode text\n```", "| h |\n| - |\n| cell |"].join("\n\n");

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
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error(wanted);
  }, text);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`SC-005 the menu in a list item, a code block and a table, and both pickers, pass axe in ${colorScheme} mode`, async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "A11y", detailsMd: DOC })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ colorScheme });
      await page.locator("li[data-kind='task'] .title").first().click();
      const editor = details(page);
      await editor.click();
      for (const [text, label] of [
        ["one", "list item"],
        ["code text", "code block"],
        ["cell", "table"],
      ] as const) {
        await caretIn(editor, text);
        await expect(menu(page)).toBeVisible();
        await expectNoA11yViolations(page, `${colorScheme}: menu in a ${label}`);
      }
      await caretIn(editor, "Plain");
      for (const name of ["Text color", "Highlight color"]) {
        // 013 FR-042: the highlight picker opens from the one Highlight button.
        if (name === "Highlight color") await openHighlightPicker(page);
        else await openTextColorPicker(page);
        await expect(colorPicker(page)).toBeVisible();
        await expectNoA11yViolations(page, `${colorScheme}: ${name} picker`);
        await page.keyboard.press("Escape");
      }
    } finally {
      await app.close();
    }
  });
}

test("FR-033a FR-034 every new or changed option is named and exposes its state", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "States", detailsMd: DOC })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await page.locator("li[data-kind='task'] .title").first().click();
    const editor = details(page);
    await editor.click();
    await caretIn(editor, "two");
    const names: Record<string, string> = {
      check: "Checklist",
      indent: "Indent",
      "size-up": "Increase font size",
      "size-down": "Decrease font size",
      quote: "Quote",
      mark: "Highlight",
    };
    for (const [cmd, name] of Object.entries(names)) await expect(button(page, cmd), cmd).toHaveAccessibleName(name);
    // Pressed state where the button has one; never on the step buttons.
    await expect(button(page, "check")).toHaveAttribute("aria-pressed", "false");
    await expect(button(page, "mark")).toHaveAttribute("aria-pressed", "false");
    for (const cmd of ["indent", "size-up", "size-down"]) await expect(button(page, cmd), cmd).not.toHaveAttribute("aria-pressed", /.*/);
    // Disabled states.
    await caretIn(editor, "code text");
    for (const cmd of ["strong", "size-up", "size-down", "mark", "check", "indent"]) await expect(button(page, cmd), cmd).toHaveAttribute("aria-disabled", "true");
    await caretIn(editor, "cell");
    await expect(button(page, "table-delete")).toHaveAccessibleName("Delete table");
    // The toolbar is described by its label.
    await expect(menu(page)).toHaveAccessibleDescription("Table cell");
  } finally {
    await app.close();
  }
});

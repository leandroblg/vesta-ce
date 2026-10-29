// 005 US3: the floating editing menu (quickstart scenario 9, tasks T045).
import { expect, test, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu, pickCustomColor, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const TITLE_OPTIONS = [
  "Bold",
  "Italic",
  "Underline",
  "Strikethrough",
  "Code",
  // 014 FR-016 (Q196): in a title, Text color ends the first row and Highlight starts the second.
  "Text color",
  "Highlight",
  // 012 FR-014: two step buttons replace Font size.
  "Increase font size",
  "Decrease font size",
  "Heading",
  "Link",
  "Insert file or image",
];
// 012 FR-006: Indent follows Checklist in the details.
const DETAILS_EXTRA = ["Bulleted list", "Numbered list", "Checklist", "Indent", "Quote", "Code block", "Divider", "Table"];

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

async function editTitle(page: Page) {
  await card(page).locator(".title").dblclick();
  const editor = card(page).locator(".ProseMirror");
  await expect(editor).toBeFocused();
  return editor;
}

async function names(page: Page): Promise<string[]> {
  // The option rows only: the link panel's buttons are not options (016 FR-013).
  return menu(page)
    .locator(".fm-row button:not([hidden])")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
}

/** 014 FR-014 to FR-016: the shown buttons of one row. */
async function rowNames(page: Page, i: number): Promise<string[]> {
  return menu(page)
    .locator(".fm-row")
    .nth(i)
    .locator("button:not([hidden])")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
}

async function launch(title: string, details = "") {
  const dataDir = freshDataDir();
  const a = task({ titleMd: title, detailsMd: details });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

test.describe("005 US3 — the floating menu", () => {
  test("a selection in a title shows the menu just above it, labelled Selection, with the title options (9)", async () => {
    const { app, page } = await launch("Renew the passport");
    try {
      const editor = await editTitle(page);
      await selectText(editor, "passport");
      await expect(menu(page)).toBeVisible();
      await expect(menu(page).locator(".fm-scope")).toHaveText("Selection");
      expect(await names(page)).toEqual(TITLE_OPTIONS);
      expect(await rowNames(page, 0)).toEqual(TITLE_OPTIONS.slice(0, 6));
      expect(await rowNames(page, 1)).toEqual(TITLE_OPTIONS.slice(6));
      const gap = await page.evaluate(() => {
        const range = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
        const box = document.querySelector(".fmenu:not([hidden])")?.getBoundingClientRect();
        return range && box ? range.top - box.bottom : NaN;
      });
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(12);
    } finally {
      await app.close();
    }
  });

  test("text color, highlight, underline and size store their canonical forms (9)", async () => {
    const { app, page, dataDir, id } = await launch("alpha beta gamma delta");
    try {
      let editor = await editTitle(page);
      await selectText(editor, "alpha");
      await pickCustomColor(page, "Text color", "#ff8800");
      await selectText(editor, "beta");
      await menu(page).getByRole("button", { name: "Highlight", exact: true }).click();
      await selectText(editor, "gamma");
      await pickCustomColor(page, "Highlight color", "#ffe066");
      await selectText(editor, "delta");
      await menu(page).getByRole("button", { name: "Underline" }).click();
      await menu(page).getByRole("button", { name: "Increase font size" }).click();
      await expect(menu(page).getByRole("button", { name: "Underline" })).toHaveAttribute("aria-pressed", "true");
      await editor.press("Enter");
      await expect
        .poll(() => readTask(dataDir, id)?.title_md)
        .toBe('[alpha]{color="#ff8800ff"} ==beta== [gamma]{bg="#ffe066ff"} [delta]{size="1.25em" .underline}');

      // FR-024a: Heading covers the whole title even with half of it selected; size only the selection.
      editor = await editTitle(page);
      await selectText(editor, "alpha");
      await menu(page).getByRole("button", { name: "Heading" }).click();
      await expect(editor.locator("h1")).toHaveCount(1);
      await editor.press("Enter");
      await expect
        .poll(() => readTask(dataDir, id)?.title_md)
        .toBe('# [alpha]{color="#ff8800ff"} ==beta== [gamma]{bg="#ffe066ff"} [delta]{size="1.25em" .underline}');
    } finally {
      await app.close();
    }
  });

  test("Link opens the link panel; Enter applies it (9; 016 FR-013)", async () => {
    const { app, page, dataDir, id } = await launch("see the docs");
    try {
      const editor = await editTitle(page);
      await selectText(editor, "docs");
      await menu(page).getByRole("button", { name: "Link" }).click();
      await expect(menu(page).getByRole("textbox", { name: "Link text" })).toHaveValue("docs");
      const url = menu(page).getByRole("textbox", { name: "Link", exact: true });
      await expect(url).toBeFocused();
      await url.fill("https://example.com/docs");
      await url.press("Enter");
      await expect(editor).toBeFocused();
      await editor.press("Enter");
      await expect.poll(() => readTask(dataDir, id)?.title_md).toBe("see the [docs](https://example.com/docs)");
    } finally {
      await app.close();
    }
  });

  // 012 FR-001, FR-002 (PRD Q149) changed this scenario: with nothing selected, the menu acts on the cursor's block.
  test("with nothing selected in the details, the menu sits above them, labelled with the cursor's block, and Bold makes that block bold (9)", async () => {
    const { app, page, dataDir, id } = await launch("Notes", "one\n\ntwo");
    try {
      await card(page).locator(".title").click();
      const details = panel(page).getByRole("textbox", { name: "Details" });
      await details.click();
      await page.keyboard.press("ControlOrMeta+End");
      await expect(menu(page)).toBeVisible();
      await expect(menu(page).locator(".fm-scope")).toHaveText("Paragraph");
      expect(await names(page)).toEqual([...TITLE_OPTIONS.slice(0, 10), ...DETAILS_EXTRA, "Link", "Insert file or image"]);
      expect(await rowNames(page, 0)).toEqual(TITLE_OPTIONS.slice(0, 10));
      expect(await rowNames(page, 1)).toEqual([...DETAILS_EXTRA, "Link", "Insert file or image"]);
      const below = await page.evaluate(() => {
        const box = document.querySelector(".fmenu:not([hidden])")?.getBoundingClientRect();
        const host = document.querySelector("[aria-label='Details'][role='textbox']")?.getBoundingClientRect();
        return box && host ? host.top - box.bottom : NaN;
      });
      expect(below).toBeGreaterThanOrEqual(0);
      await menu(page).getByRole("button", { name: "Bold" }).click();
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      expect(readTask(dataDir, id)?.details_md).toBe("one\n\n**two**");
    } finally {
      await app.close();
    }
  });

  test("details options: lists, quote, code block, divider and table (9)", async () => {
    const { app, page, dataDir, id } = await launch("Blocks", "item");
    try {
      await card(page).locator(".title").click();
      const details = panel(page).getByRole("textbox", { name: "Details" });
      await details.click();
      for (const [option, element] of [
        ["Bulleted list", "ul"],
        ["Numbered list", "ol"],
        ["Quote", "blockquote"],
        ["Code block", "pre"],
      ] as const) {
        await selectText(details, "item");
        await menu(page).getByRole("button", { name: option }).click();
        await expect(details.locator(element).first(), option).toBeVisible();
        await page.keyboard.press("ControlOrMeta+z");
        await expect(details.locator(element), option).toHaveCount(0);
      }
      await selectText(details, "item");
      await menu(page).getByRole("button", { name: "Checklist" }).click();
      await expect(details.locator("li[data-item-type='task']")).toHaveCount(1);
      await menu(page).getByRole("button", { name: "Divider" }).click();
      await expect(details.locator("hr")).toHaveCount(1);
      await menu(page).getByRole("button", { name: "Table" }).click();
      await expect(details.locator("table")).toHaveCount(1);
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      const md = readTask(dataDir, id)?.details_md ?? "";
      expect(md, JSON.stringify(md)).toMatch(/^- \[ \] item\n\n---\n\n\|/);
    } finally {
      await app.close();
    }
  });

  test("keyboard: Tab reaches the toolbar, arrows move through named options with their state; Esc closes the menu, then the editor (9)", async () => {
    const { app, page, dataDir, id } = await launch("**Bold** word");
    try {
      const editor = await editTitle(page);
      await selectText(editor, "Bold");
      await page.keyboard.press("Tab");
      const bold = menu(page).getByRole("button", { name: "Bold" });
      await expect(bold).toBeFocused();
      await expect(bold).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("ArrowRight");
      await expect(menu(page).getByRole("button", { name: "Italic" })).toBeFocused();
      await expect(menu(page).getByRole("button", { name: "Italic" })).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("End");
      await expect(menu(page).getByRole("button", { name: "Insert file or image" })).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(menu(page).getByRole("button", { name: "Link" })).toBeFocused();
      await page.keyboard.press("Enter");
      // 016 FR-013 (Q233): the link panel, the focus in its Link field.
      await expect(menu(page).getByRole("textbox", { name: "Link", exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(editor).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(menu(page).getByRole("button", { name: "Link" })).toBeFocused();
      // Esc in the menu closes it (back to the editor); the next Esc closes the editor and discards.
      await page.keyboard.press("Escape");
      await expect(editor).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(card(page).locator(".ProseMirror")).toHaveCount(0);
      expect(readTask(dataDir, id)?.title_md).toBe("**Bold** word");
    } finally {
      await app.close();
    }
  });
});

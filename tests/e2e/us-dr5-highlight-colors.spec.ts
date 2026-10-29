// 012 US5: highlights and colors that are easy to remove (quickstart scenario 8, tasks T058).
import { expect, test, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu, openHighlightPicker, openTextColorPicker, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const picker = (page: Page) => page.locator(".cpick");
const button = (page: Page, name: string) => menu(page).getByRole("button", { name, exact: true });

async function launch(detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Highlights", detailsMd });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  await card(run.page).locator(".title").click();
  return { ...run, dataDir, id: a.id };
}

const stored = (dataDir: string, id: string) => readTask(dataDir, id)?.details_md;
const selection = (page: Page) => page.evaluate(() => window.getSelection()?.toString() ?? "");

test.describe("012 US5 — highlights and colors", () => {
  test("FR-018 FR-019 a double click selects the whole highlighted run; Highlight then removes it", async () => {
    const { app, page, dataDir, id } = await launch('a ==two words== b [x y]{bg="#ffe066ff"} [red]{color="#dd3333ff"}');
    try {
      await details(page).locator("mark").dblclick();
      await expect.poll(() => selection(page)).toBe("two words");
      await expect(button(page, "Highlight")).toHaveAttribute("aria-pressed", "true");
      await button(page, "Highlight").click();
      await expect.poll(() => stored(dataDir, id)).toBe('a two words b [x y]{bg="#ffe066ff"} [red]{color="#dd3333ff"}');
      await details(page).locator("[data-bg]").dblclick();
      await expect.poll(() => selection(page)).toBe("x y");
      await details(page).locator("[data-color]").dblclick();
      await expect.poll(() => selection(page)).toBe("red");
    } finally {
      await app.close();
    }
  });

  test("FR-020 FR-021 the pickers' first choices read Remove color and Remove highlight and remove what they name", async () => {
    const { app, page, dataDir, id } = await launch('[a]{color="#dd3333ff"} ==b== [c]{bg="#ffe066ff"}');
    try {
      const editor = details(page);
      await selectText(editor, "a");
      await openTextColorPicker(page);
      await picker(page).getByRole("button", { name: "Remove color" }).click();
      await expect.poll(() => stored(dataDir, id)).toBe('a ==b== [c]{bg="#ffe066ff"}');
      await selectText(editor, "b");
      await openHighlightPicker(page);
      await picker(page).getByRole("button", { name: "Remove highlight" }).click();
      await expect.poll(() => stored(dataDir, id)).toBe('a b [c]{bg="#ffe066ff"}');
      await selectText(editor, "c");
      await openHighlightPicker(page);
      await picker(page).getByRole("button", { name: "Remove highlight" }).click();
      await expect.poll(() => stored(dataDir, id)).toBe("a b c");
    } finally {
      await app.close();
    }
  });

  test("FR-022 the first choice is reached and chosen by keyboard and announced by its name", async () => {
    const { app, page, dataDir, id } = await launch("==lit==");
    try {
      await selectText(details(page), "lit");
      await openHighlightPicker(page);
      const first = picker(page).getByRole("button", { name: "Remove highlight" });
      await expect(first).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => stored(dataDir, id)).toBe("lit");
    } finally {
      await app.close();
    }
  });
});

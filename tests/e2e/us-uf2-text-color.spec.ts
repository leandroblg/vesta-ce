/**
 * 016 User Story 4: the Text color button applies the last text color picked; a hold or Shift+Enter opens the picker
 * (FR-019 to FR-022; PRD Q223, Q252; ui.md "Floating menu").
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { colorPicker, menu, openHighlightPicker, openTextColorPicker, selectText } from "./fixtures/editor";
import { exportFolder, exportVia, importVia } from "./fixtures/export";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { clickMenu } from "./fixtures/menu";
import { reminderCard } from "./fixtures/reminders";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { closeSettings } from "./fixtures/settings";

const EMBER = "rgb(185, 65, 28)";
const BLUE_600 = "rgb(37, 99, 235)";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const colorButton = (page: Page) => menu(page).getByRole("button", { name: "Text color", exact: true });
const swatch = (page: Page) => colorButton(page).locator("span[data-glyph]").evaluate((el) => getComputedStyle(el).borderBottomColor);

async function hold(page: Page, ms = 650): Promise<void> {
  const b = await colorButton(page).boundingBox();
  if (b === null) throw new Error("no box");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe("016 US4 — the Text color button", () => {
  test("on a fresh profile the swatch is ember in the title, reminder and details menus; a click applies it and a second click removes it", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Paint me", detailsMd: "alpha beta" });
    seedTasks(dataDir, [a]);
    seedReminders(dataDir, [reminder({ textMd: "Remind me" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      // The details.
      await taskCard(page, "Paint me").locator(".title").click();
      await selectText(details(page), "beta");
      expect(await swatch(page)).toBe(EMBER);
      await expect(colorButton(page)).toHaveAttribute("aria-pressed", "false");
      await colorButton(page).click();
      await expect(colorButton(page)).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe('alpha [beta]{color="#b9411cff"}');
      await colorButton(page).click();
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("alpha beta");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // A title: nothing selected colors the whole title.
      await taskCard(page, "Paint me").locator(".title").dblclick();
      expect(await swatch(page)).toBe(EMBER);
      await colorButton(page).click();
      await page.keyboard.press("Enter");
      await expect.poll(() => readTask(dataDir, a.id)?.title_md).toBe('[Paint me]{color="#b9411cff"}');

      // A reminder.
      await reminderCard(page, "Remind me").locator(".title").dblclick();
      expect(await swatch(page)).toBe(EMBER);
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("a hold opens the picker; a pick applies and becomes the swatch, after a restart and through export and import; a highlight pick leaves it; Format › Text Color… opens the picker", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Pick", detailsMd: "one two three" });
    seedTasks(dataDir, [a]);
    const run = await launchVesta({ dataDir });
    let { app, page } = run;
    const folder = exportFolder();
    try {
      await taskCard(page, "Pick").locator(".title").click();
      await selectText(details(page), "one");
      await hold(page);
      await expect(colorPicker(page)).toHaveAttribute("aria-label", "Text color");
      await colorPicker(page).getByRole("gridcell", { name: "Blue 600" }).click();
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe('[one]{color="#2563ebff"} two three');
      expect(await swatch(page)).toBe(BLUE_600);

      // A highlight pick and Remove color leave the swatch.
      await selectText(details(page), "two");
      await openHighlightPicker(page);
      await colorPicker(page).locator("[data-section='preset'][role='gridcell']").first().click();
      await openTextColorPicker(page);
      await colorPicker(page).getByRole("button", { name: "Remove color" }).click();
      expect(await swatch(page)).toBe(BLUE_600);

      // Format › Text Color… opens the picker.
      await selectText(details(page), "three");
      await clickMenu(app, "fmt:color");
      await expect(colorPicker(page)).toHaveAttribute("aria-label", "Text color");
      await page.keyboard.press("Escape");

      // A restart keeps it.
      await page.keyboard.press("Escape");
      ({ app, page } = await relaunch({ ...run, app, page }));
      await taskCard(page, "Pick").locator(".title").click();
      await selectText(details(page), "three");
      expect(await swatch(page)).toBe(BLUE_600);
      await page.keyboard.press("Escape");
      await exportVia(app, page, folder);
      const exported = readdirSync(folder).find((f) => f.endsWith(".zip")) ?? "";
      expect(exported).not.toBe("");
      await closeSettings(page);
      await app.close();

      // Into a fresh profile.
      const other = freshDataDir();
      seedTasks(other, [task({ titleMd: "Fresh", detailsMd: "word" })]);
      ({ app, page } = await launchVesta({ dataDir: other }));
      expect(await importVia(app, page, join(folder, exported))).toBe("merged");
      await taskCard(page, "Fresh").locator(".title").click();
      await selectText(details(page), "word");
      expect(await swatch(page)).toBe(BLUE_600);
    } finally {
      await app.close();
    }
  });
});

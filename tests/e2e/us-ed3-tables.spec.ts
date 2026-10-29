// 011 US3: insert a table of the size I need and change it later (quickstart scenarios 10 and 11, tasks T065).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const grid = (page: Page) => page.locator(".tsize:not([hidden])");
const tableButton = (page: Page) => menu(page).getByRole("button", { name: "Table", exact: true });

/** Columns and rows of the first stored table, the header counting as a row. */
function shape(md: string | undefined): { cols: number; rows: number } {
  const lines = (md ?? "").split("\n").filter((l) => l.startsWith("|") && !/^\|\s*:?-/.test(l));
  return { rows: lines.length, cols: (lines[0]?.split("|").length ?? 2) - 2 };
}

async function launch(detailsMd = "start") {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Tables", detailsMd });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

async function openDetails(page: Page): Promise<Locator> {
  await card(page).locator(".title").click();
  const editor = details(page);
  await editor.click();
  await page.keyboard.press("End");
  return editor;
}

test.describe("011 US3 — tables", () => {
  test("FR-018 FR-019 FR-020 a click inserts 3 × 3; a held press, release and click on a cell insert 4 × 2", async () => {
    const { app, page, dataDir, id } = await launch();
    try {
      await openDetails(page);
      await tableButton(page).click();
      await expect.poll(() => shape(readTask(dataDir, id)?.details_md)).toEqual({ cols: 3, rows: 3 });

      await page.keyboard.press("ControlOrMeta+z");
      await details(page).click();
      const box = await tableButton(page).boundingBox();
      if (box === null) throw new Error("no Table button");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(650);
      await page.mouse.up();
      await expect(grid(page)).toBeVisible();
      await expect(grid(page).locator(".tsize-label")).toHaveText("1 × 1");
      await grid(page).locator('.ts-cell[data-col="4"][data-row="2"]').hover();
      await expect(grid(page).locator(".tsize-label")).toHaveText("4 × 2");
      await grid(page).locator('.ts-cell[data-col="4"][data-row="2"]').click();
      await expect.poll(() => shape(readTask(dataDir, id)?.details_md)).toEqual({ cols: 4, rows: 2 });
    } finally {
      await app.close();
    }
  });

  test("SC-005 the keyboard inserts 4 × 2 with 2 key presses plus arrows; FR-020a the fields insert 30 × 5", async () => {
    const { app, page, dataDir, id } = await launch();
    try {
      await openDetails(page);
      await tableButton(page).focus();
      let presses = 0;
      await page.keyboard.press("Shift+Enter");
      presses++;
      await expect(grid(page).locator(".ts-grid")).toBeFocused();
      for (const k of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowDown"]) await page.keyboard.press(k);
      await page.keyboard.press("Enter");
      presses++;
      expect(presses).toBeLessThanOrEqual(4);
      await expect.poll(() => shape(readTask(dataDir, id)?.details_md)).toEqual({ cols: 4, rows: 2 });

      await page.keyboard.press("ControlOrMeta+z");
      await details(page).click();
      await tableButton(page).focus();
      await page.keyboard.press("Shift+Enter");
      await grid(page).getByLabel("Columns", { exact: true }).fill("30");
      await grid(page).getByLabel("Rows", { exact: true }).fill("5");
      await grid(page).getByRole("button", { name: "Insert" }).click();
      await expect.poll(() => shape(readTask(dataDir, id)?.details_md)).toEqual({ cols: 30, rows: 5 });
    } finally {
      await app.close();
    }
  });

  test("FR-020b the rows-first checkbox swaps the fields and the size text, and survives a relaunch", async () => {
    const run = await launch();
    let { app, page } = run;
    try {
      await openSettings(page, "General");
      await dialog(page).getByTestId("table-rows-first").check();
      await closeSettings(page);
      ({ app, page } = await relaunch({ ...run, app, page }));
      await openSettings(page, "General");
      await expect(dialog(page).getByTestId("table-rows-first")).toBeChecked();
      await closeSettings(page);
      await openDetails(page);
      await tableButton(page).focus();
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.press("ArrowRight");
      await expect(grid(page).locator(".tsize-label")).toHaveText("1 × 2");
      await expect(grid(page).locator(".ts-field > span")).toHaveText(["Rows", "Columns"]);
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("FR-021 a handle adds a row by mouse; a menu option deletes a column by keyboard", async () => {
    const { app, page, dataDir, id } = await launch("| h1 | h2 |\n| -- | -- |\n| a1 | a2 |");
    try {
      await card(page).locator(".title").click();
      const editor = details(page);
      await editor.locator("td", { hasText: "a1" }).click();
      await editor.locator("td", { hasText: "a1" }).hover();
      await page.locator(".tbl-h-row").click();
      // The overlay is a mouse aid hidden from assistive technology (the toolbar options are the accessible path).
      await page.locator(".tbl-menu button", { hasText: "Add row below" }).click();
      await expect.poll(() => shape(readTask(dataDir, id)?.details_md)).toEqual({ cols: 2, rows: 3 });

      await editor.locator("td", { hasText: "a2" }).click();
      await menu(page).getByRole("button", { name: "Remove column" }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => shape(readTask(dataDir, id)?.details_md)).toEqual({ cols: 1, rows: 3 });
      await expect(menu(page).getByRole("button", { name: "Remove column" })).toBeHidden();
    } finally {
      await app.close();
    }
  });
});

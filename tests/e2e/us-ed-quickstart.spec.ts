// 011 runbook step L, automated (quickstart scenarios 1, 5, 9, 10, 12 and 14 in one profile, tasks T084).
import { expect, test } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { colorPicker, menu, openTextColorPicker, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { IS_MAC } from "./fixtures/settings";

test("011 step L: rewrite, toggles, picker, table size, card area, read-only panel and the key's name in one profile", async () => {
  test.setTimeout(120_000);
  const dataDir = freshDataDir();
  const now = Date.now();
  const a = task({ titleMd: '[Plan]{color="#d33"} trip', detailsMd: "alpha\n\nbeta", position: 1 });
  const b = task({ titleMd: "Archived item", doneAt: now - 1000, position: 2 });
  seedTasks(dataDir, [a, b]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    // 9: the stored color is rewritten once, 8 digits.
    await expect.poll(() => readTask(dataDir, a.id)?.title_md).toBe('[Plan]{color="#dd3333ff"} trip');

    // 12: a click on the empty space right of the title opens the panel.
    const card = page.locator(`li[data-id="${a.id}"]`);
    const box = await card.boundingBox();
    if (box === null) throw new Error("no card");
    await page.mouse.click(box.x + box.width - 80, box.y + box.height - 5);
    const panel = page.getByRole("complementary", { name: "Details" });
    await expect(panel).toBeVisible();

    // 1: a toggle applied and pressed again returns the original markdown.
    const details = panel.getByRole("textbox", { name: "Details" });
    await selectText(details, "alpha");
    await menu(page).getByRole("button", { name: "Quote", exact: true }).click();
    await selectText(details, "alpha");
    await menu(page).getByRole("button", { name: "Quote", exact: true }).click();

    // 5: a preset from the picker.
    await selectText(details, "beta");
    await openTextColorPicker(page);
    await colorPicker(page).getByRole("gridcell", { name: "Blue 600" }).click();

    // 10: Shift+Enter on Table opens the grid; 2 × 2 by keyboard.
    await menu(page).getByRole("button", { name: "Table", exact: true }).focus();
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => readTask(dataDir, a.id)?.details_md)
      .toMatch(/^alpha\n\n\[beta\]\{color="#2563ebff"\}\n\n\| +\| +\|\n\| [-:]+ \| [-:]+ \|\n\| +\| +\|$/);
    await page.keyboard.press("Escape");

    // 14: the inline edit hint names the key for this OS.
    await card.locator(".title").dblclick();
    await expect(card.locator(".edit-hint")).toHaveText(`${IS_MAC ? "Return" : "Enter"} to save · Esc to cancel`);
    await page.keyboard.press("Escape");

    // 12b: the Archive opens the read-only panel with Enter on the selected row.
    await page.getByRole("button", { name: /Archive/ }).first().click();
    await page.locator(`li[data-id="${b.id}"]`).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("complementary", { name: "Details" })).toHaveAttribute("data-readonly", "");
  } finally {
    await app.close();
  }
});

// 011 accessibility (quickstart scenario 16, tasks T085): FR-029, SC-003, SC-008 in light and dark.
import { expect, test, type Page } from "@playwright/test";
import { PRESET_COLORS } from "../../src/domain/markdown/colors";
import { expectNoA11yViolations } from "./fixtures/axe";
import { colorPicker, menu, openHighlightPicker, openTextColorPicker, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { dialog, openSettings } from "./fixtures/settings";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

// Every preset as text and as a highlight, plus Automatic text: all scanned, none excluded (SC-003).
const COLORS = [
  PRESET_COLORS.map((c, i) => `[t${String(i)}]{color="${c.hex}"}`).join(" "),
  PRESET_COLORS.map((c, i) => `[h${String(i)}]{bg="${c.hex}"}`).join(" "),
  "Automatic text with no color.",
  "| a | b |\n| -- | -- |\n| 1 | 2 |",
].join("\n\n");

for (const colorScheme of ["light", "dark"] as const) {
  test(`FR-029 SC-003 SC-008 every preset as text and highlight, the picker, the size grid, the table options, the read-only panel and Appearance pass axe in ${colorScheme} mode`, async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [
      task({ titleMd: "Colors", detailsMd: COLORS, position: 1 }),
      task({ titleMd: "Archived", detailsMd: "read **only**", doneAt: now - 1000, position: 2 }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ colorScheme });
      await page.locator("li[data-kind='task'] .title", { hasText: "Colors" }).click();
      const details = panel(page).getByRole("textbox", { name: "Details" });
      await expect(details).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: every preset in the details`);

      await selectText(details, "Automatic");
      await openTextColorPicker(page);
      await expect(colorPicker(page)).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: color picker`);
      await page.keyboard.press("Escape");

      await details.locator("td", { hasText: "1" }).click();
      await expect(menu(page).getByRole("button", { name: "Add row below" })).toBeVisible();
      await menu(page).getByRole("button", { name: "Table", exact: true }).focus();
      await page.keyboard.press("Shift+Enter");
      await expect(page.locator(".tsize:not([hidden])")).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: size grid and table options`);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /Archive/ }).first().click();
      await page.locator("li.arow", { hasText: "Archived" }).click({ position: { x: 20, y: 10 } });
      await expect(panel(page)).toHaveAttribute("data-readonly", "");
      await expectNoA11yViolations(page, `${colorScheme}: read-only panel`);
      await page.keyboard.press("Escape");

      await openSettings(page, "General");
      await expect(dialog(page).getByTestId("table-rows-first")).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: Settings with Appearance`);
    } finally {
      await app.close();
    }
  });
}

test("FR-029 every new control is reachable with the keyboard and named", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Keys", detailsMd: "word" })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await page.locator("li[data-kind='task'] .title").click();
    const details = panel(page).getByRole("textbox", { name: "Details" });
    await selectText(details, "word");
    await openHighlightPicker(page);
    const named = await colorPicker(page)
      .locator("button, [role='option'], [role='gridcell']")
      .evaluateAll((els) => els.filter((e) => (e.getAttribute("aria-label") ?? e.textContent).trim() === "").length);
    expect(named).toBe(0);
    // One Tab stop per section: Remove highlight (012 FR-021), the preset grid, then (no pinned or recent colors yet) Custom color….
    await expect(colorPicker(page).getByRole("button", { name: "Remove highlight" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(colorPicker(page).getByRole("gridcell").first()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(colorPicker(page).getByRole("button", { name: "Custom color…" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page).getByRole("button", { name: "Highlight", exact: true })).toBeFocused();
  } finally {
    await app.close();
  }
});

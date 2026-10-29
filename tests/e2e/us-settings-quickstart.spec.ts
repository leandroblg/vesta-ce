/** The runbook card 007 hand checks (step L), automated (quickstart 1–7; T068; memory: no manual tests). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, HOUR, tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { MOD, capture, dialog, openSettings, selectedTitle, setLanguage, setOsLanguages } from "./fixtures/settings";

const lang = (page: Page) => page.locator("html");
const native = (app: ElectronApplication) => app.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

test.describe("007 runbook checks", () => {
  test("1. a fresh data folder follows the OS language; an unsupported OS language gives English", async () => {
    let run = await launchVesta({ env: { VESTA_TEST_OS_LANGS: "de-DE,fr-FR" } });
    await expect(lang(run.page)).toHaveAttribute("lang", "fr");
    await run.app.close();
    run = await launchVesta({ env: { VESTA_TEST_OS_LANGS: "ja-JP" } });
    await expect(lang(run.page)).toHaveAttribute("lang", "en");
    await run.app.close();
  });

  test("2. French shows French text and 12j 3h ages", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Vieille tâche", createdAt: Date.now() - 12 * DAY - 3 * HOUR - 60_000 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await setLanguage(page, "fr", "fr");
      await page.keyboard.press("Escape");
      await tick(page);
      await expect(page.getByRole("heading", { name: "Tâches" })).toBeVisible();
      await expect(taskCard(page, "Vieille tâche")).toContainText("12j 3h");
    } finally {
      await app.close();
    }
  });

  test("3. with Use system language, an OS language change switches Vesta at once", async () => {
    const { app, page } = await launchVesta();
    try {
      await setOsLanguages(app, ["it-IT"]);
      await expect(lang(page)).toHaveAttribute("lang", "it");
      await expect(page.getByRole("heading", { name: "Attività" })).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("4. a picked language stays across OS changes and restarts; Use system language follows the OS again", async () => {
    const first = await launchVesta();
    await setLanguage(first.page, "fr", "fr");
    await setOsLanguages(first.app, ["es-ES"]);
    await expect(lang(first.page)).toHaveAttribute("lang", "fr");
    await first.app.close();
    const { app, page } = await launchVesta({ dataDir: first.dataDir, env: { VESTA_TEST_OS_LANGS: "es-ES" } });
    try {
      await expect(lang(page)).toHaveAttribute("lang", "fr");
      await setLanguage(page, "system", "es-ES");
    } finally {
      await app.close();
    }
  });

  test("5. System switches with the OS; Dark stays after a restart", async () => {
    const first = await launchVesta();
    await openSettings(first.page, "General");
    await first.page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => bg(first.page)).toBe("#1a1816");
    await first.page.emulateMedia({ colorScheme: null });
    await dialog(first.page).getByRole("radio", { name: "Dark" }).check();
    await expect.poll(() => native(first.app)).toEqual({ source: "dark", dark: true });
    await first.app.close();
    const { app, page } = await launchVesta({ dataDir: first.dataDir });
    try {
      await page.emulateMedia({ colorScheme: null });
      expect(await native(app)).toEqual({ source: "dark", dark: true });
      await expect.poll(() => bg(page)).toBe("#1a1816");
    } finally {
      await app.close();
    }
  });

  test("6. remapping a shortcut works at once; Reset to defaults restores the table", async () => {
    const { app, page } = await launchVesta();
    try {
      await capture(page, "New Task", "F4");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await page.keyboard.press("F4");
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
      await page.keyboard.press("Escape");
      await openSettings(page, "Shortcuts");
      await dialog(page).getByRole("button", { name: "Reset to defaults" }).click();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await page.keyboard.press(`${MOD}+n`);
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("7. arrows, Enter, F2 and Delete act on the selection, but not while typing", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "One", position: 1 }), task({ titleMd: "Two", position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.keyboard.press("ArrowDown");
      expect(await selectedTitle(page)).toBe("One");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
      await taskCard(page, "One").locator("[data-ctl='cb']").focus();
      await page.keyboard.press("F2");
      const editor = page.getByRole("textbox", { name: "One" });
      await expect(editor).toBeFocused();
      for (const k of ["ArrowDown", "Delete", "F2"]) await editor.press(k);
      await editor.press("Escape");
      await expect(taskCard(page, "Two")).toBeVisible();
      await page.keyboard.press("ArrowDown");
      expect(await selectedTitle(page)).toBe("Two");
      await page.keyboard.press("Delete");
      await expect(taskCard(page, "Two")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

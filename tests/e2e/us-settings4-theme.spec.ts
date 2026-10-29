/** 007 User Story 4: the theme (US4-1 to US4-4; FR-009 to FR-011; SC-005; T058). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, staleTask } from "./fixtures/seed";
import { dialog, openSettings } from "./fixtures/settings";

const LIGHT_BG = "#f3efe7";
const DARK_BG = "#1a1816";

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
/** Playwright emulates a light color scheme by default; null hands it back to Chromium, so nativeTheme decides. */
const noEmulation = (page: Page) => page.emulateMedia({ colorScheme: null });

const native = (app: ElectronApplication) =>
  app.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));

test.describe("007 US4 — choose the theme", () => {
  test("System is the default and follows the OS appearance at once (US4-1, US4-3, FR-011)", async () => {
    const { app, page } = await launchVesta();
    try {
      expect((await native(app)).source).toBe("system");
      await openSettings(page, "General");
      await expect(dialog(page).getByRole("radio", { name: "System" })).toBeChecked();
      // Media emulation stands in for the OS change; only with Follow OS (analysis T1).
      await page.emulateMedia({ colorScheme: "dark" });
      await expect.poll(() => bg(page), { timeout: 1000 }).toBe(DARK_BG);
      await page.emulateMedia({ colorScheme: "light" });
      await expect.poll(() => bg(page), { timeout: 1000 }).toBe(LIGHT_BG);
    } finally {
      await app.close();
    }
  });

  test("Dark and Light apply at once whatever the OS; Dark stays after a restart from the first frame (US4-2, FR-010, SC-005)", async () => {
    const run = await launchVesta();
    let { app, page } = run;
    try {
      await noEmulation(page);
      await openSettings(page, "General");
      await dialog(page).getByRole("radio", { name: "Dark" }).check();
      await expect.poll(() => native(app)).toEqual({ source: "dark", dark: true });
      await expect.poll(() => bg(page)).toBe(DARK_BG);
      await dialog(page).getByRole("radio", { name: "Light" }).check();
      await expect.poll(() => native(app)).toEqual({ source: "light", dark: false });
      await expect.poll(() => bg(page)).toBe(LIGHT_BG);
      await dialog(page).getByRole("radio", { name: "Dark" }).check();
      await expect.poll(() => native(app)).toEqual({ source: "dark", dark: true });
      await app.close();

      ({ app, page } = await launchVesta({ dataDir: run.dataDir, waitReady: false }));
      await noEmulation(page);
      const color = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase());
      expect(color).toBe(DARK_BG);
      expect(await bg(page)).toBe(DARK_BG);
    } finally {
      await app.close();
    }
  });

  test("stale rows use the theme's own stale tokens (US4-4)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [staleTask({ titleMd: "Old one" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await noEmulation(page);
      const stale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--stale-soft").trim());
      await openSettings(page, "General");
      await dialog(page).getByRole("radio", { name: "Light" }).check();
      await expect.poll(stale).toBe("#f4e8e1");
      await dialog(page).getByRole("radio", { name: "Dark" }).check();
      await expect.poll(stale).toBe("#432e28");
      await expect(taskCard(page, "Old one")).toHaveClass(/stale/);
    } finally {
      await app.close();
    }
  });

  test("the theme choice is one Tab stop; arrows change it (CHK016)", async () => {
    const { app, page } = await launchVesta();
    await openSettings(page, "General");
    try {
      const light = dialog(page).getByRole("radio", { name: "Light" });
      await light.check();
      await light.focus();
      await page.keyboard.press("ArrowRight");
      await expect(dialog(page).getByRole("radio", { name: "Dark" })).toBeChecked();
      await expect.poll(() => native(app)).toEqual({ source: "dark", dark: true });
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).not.toBe("radio");
    } finally {
      await app.close();
    }
  });
});

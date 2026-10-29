// 009 accessibility (FR-020, FR-024, FR-031; constitution V; quickstart 15).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures/axe";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedLogs } from "./fixtures/logs";
import { answer, release, releasesFile } from "./fixtures/releases";
import { dialog, openSettings, showPane } from "./fixtures/settings";

async function newer(app: ElectronApplication): Promise<string> {
  const v = await app.evaluate(({ app: a }) => a.getVersion());
  return `${String(Number(v.split(".")[0]) + 1)}.0.0`;
}

const viewer = (page: Page) => page.getByRole("dialog", { name: "Logs" });

test.describe("009 accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`Settings sections, the log viewer and the update notice pass axe in ${colorScheme} mode`, async () => {
      test.setTimeout(90_000);
      const dataDir = freshDataDir();
      seedLogs(dataDir, { numbers: [1], perFile: 30, levels: ["fatal", "error", "warn", "info", "debug", "trace"] });
      // An unreadable line too.
      const first = await launchVesta({ dataDir });
      const v = await newer(first.app);
      await first.app.close();
      const { app, page } = await launchVesta({ dataDir, env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)])) } });
      try {
        await page.emulateMedia({ colorScheme });
        await expect(page.getByTestId("notification")).toHaveAttribute("data-kind", "update", { timeout: 10_000 });
        await expectNoA11yViolations(page, `${colorScheme}: update notice and cogwheel mark`);
        await page.getByTestId("update-view").click();
        await expect(page.getByTestId("release-notes")).toBeVisible();
        await expectNoA11yViolations(page, `${colorScheme}: Settings with Logs, Updates and About`);
        await showPane(page, "Data");
        await dialog(page).getByTestId("logs-open").click();
        await expect(viewer(page).locator("li[data-key]").first()).toBeVisible();
        await expectNoA11yViolations(page, `${colorScheme}: log viewer`);
      } finally {
        await app.close();
      }
    });
  }

  test("keyboard: every control is reachable; Esc returns to the Logs button; names and announcements are right", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      const logsButton = dialog(page).getByTestId("logs-open");
      await logsButton.focus();
      await page.keyboard.press("Enter");
      await expect(viewer(page)).toBeVisible();
      await expect(page.getByTestId("log-list")).toBeFocused();
      // The list scrolls by keyboard: it is a focusable region with a name.
      await expect(page.getByTestId("log-list")).toHaveAccessibleName("Log entries, newest first");
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("button", { name: "Close" }).last()).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByTestId("log-level")).toBeFocused();
      await expect(page.getByTestId("log-level")).toHaveAccessibleName("Level");
      await page.keyboard.press("Escape");
      await expect(viewer(page)).toBeHidden();
      await expect(logsButton).toBeFocused();
      // Updates: the button, then the checkbox, by Tab; the result is announced in a polite live region.
      await showPane(page, "Updates");
      await page.getByTestId("update-check").focus();
      await page.keyboard.press("Tab");
      await expect(page.getByTestId("auto-update")).toBeFocused();
      await expect(page.getByTestId("update-status")).toHaveAttribute("role", "status");
      await expect(page.getByTestId("update-status")).toHaveAttribute("aria-live", "polite");
    } finally {
      await app.close();
    }
  });

  test("reduced motion: the viewer and the notice do not animate", async () => {
    const { app, page } = await launchVesta();
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openSettings(page, "Data");
      await dialog(page).getByTestId("logs-open").click();
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    } finally {
      await app.close();
    }
  });
});

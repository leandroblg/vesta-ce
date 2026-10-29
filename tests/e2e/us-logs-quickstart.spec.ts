// 009 runbook card 009 step L, automated (quickstart 14; PRD Q123 amended the first check).
import { expect, test } from "@playwright/test";
import { advanceClock } from "./fixtures/clock";
import { clickMenu } from "./fixtures/menu";
import { launchVesta } from "./fixtures/launch";
import { entriesFor } from "./fixtures/logs";
import { updateRequests, useReleases } from "./fixtures/releases";
import { dialog, openSettings, showPane } from "./fixtures/settings";

test.describe("009 card step L", () => {
  test("Settings → Logs shows entries; Error shows fewer at once; after Debug, new Debug lines appear", async () => {
    const { app, page, dataDir } = await launchVesta();
    try {
      await expect.poll(async () => (await updateRequests(app)).length).toBeGreaterThanOrEqual(1);
      await openSettings(page, "Data");
      await showPane(page, "Data");
      await dialog(page).getByTestId("logs-open").click();
      const rows = page.getByTestId("log-list").locator("li[data-key]");
      await expect(rows.first()).toBeVisible();
      const atInfo = await rows.count();
      await page.getByTestId("log-level").selectOption("error");
      await expect.poll(() => rows.count()).toBeLessThan(atInfo);
      await page.getByTestId("log-level").selectOption("debug");
      await page.keyboard.press("Escape");
      await advanceClock(app, 61_000);
      await showPane(page, "Updates");
      await page.getByTestId("update-check").click();
      await expect(page.getByTestId("update-check")).toBeEnabled();
      await expect.poll(() => entriesFor(dataDir, "update.check.start").length).toBeGreaterThan(0);
      await showPane(page, "Data");
      await dialog(page).getByTestId("logs-open").click();
      await expect(page.getByTestId("log-list").locator("li", { hasText: "update.check.start" }).first()).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("Check for updates gives an answer, and a failure (offline) is logged, not shown as a crash", async () => {
    const { app, page, dataDir } = await launchVesta();
    try {
      await expect.poll(async () => (await updateRequests(app)).length).toBeGreaterThanOrEqual(1);
      await openSettings(page, "Data");
      await advanceClock(app, 61_000);
      await showPane(page, "Updates");
      await page.getByTestId("update-check").click();
      await expect(page.getByTestId("update-status")).toContainText("is the latest version");
      await useReleases(app, { fail: "offline" });
      await advanceClock(app, 61_000);
      await showPane(page, "Updates");
      await page.getByTestId("update-check").click();
      await expect(page.getByTestId("update-status")).toHaveText("Vesta could not check for updates. Check your connection and try again.");
      expect(entriesFor(dataDir, "update.check.failed")).toHaveLength(1);
      await expect(page.getByTestId("notification")).toHaveCount(0);
      await expect(page.locator("[role='alert']")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("About shows the version and AGPL-3.0", async () => {
    const { app, page } = await launchVesta();
    try {
      const version = await app.evaluate(({ app: a }) => a.getVersion());
      // 013 FR-027: About is a window of its own, opened from the menu bar.
      await clickMenu(app, "about");
      await expect(page.getByTestId("about-dialog")).toContainText(version);
      await expect(page.getByTestId("about-dialog")).toContainText("AGPL-3.0");
    } finally {
      await app.close();
    }
  });
});

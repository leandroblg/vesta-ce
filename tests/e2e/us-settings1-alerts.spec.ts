/** 007 User Story 1: the Settings window and the alert settings (quickstart 8, 9, 10, 24; T043). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { MIN, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { MOD, dialog, openSettings, showPane } from "./fixtures/settings";
import { clickMenu } from "./fixtures/menu";

const group = (page: Page, name: string) => dialog(page).getByRole("group", { name });
const field = (page: Page, setting: string, unit: "Days" | "Hours" | "Minutes") => group(page, setting).getByRole("spinbutton", { name: unit });

async function setDuration(page: Page, setting: string, d: string, h: string, m: string) {
  await field(page, setting, "Days").fill(d);
  await field(page, setting, "Hours").fill(h);
  await field(page, setting, "Minutes").fill(m);
}

function storedSetting(page: Page, key: string): Promise<number> {
  return page.evaluate(async (k) => {
    const r = await window.vesta.app.getInitialState();
    return r.ok ? (r.value.alertSettings as unknown as Record<string, number>)[k] ?? -1 : -1;
  }, key);
}

test.describe("007 US1 — the Settings window and the alert settings", () => {
  test("opens by the menu bar's Settings… and by Mod+,; focus on its heading; Esc, the close button and the backdrop close it and focus returns (US1-1, US1-2, US1-6; 013 FR-023)", async () => {
    const { app, page } = await launchVesta();
    try {
      await expect(page.locator("header").getByRole("button", { name: /^Settings/ })).toHaveCount(0);
      await page.locator("#search").focus();
      await clickMenu(app, "settings");
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByRole("heading", { name: "Settings" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await expect(page.locator("#search")).toBeFocused();

      await page.keyboard.press(`${MOD}+Comma`);
      await expect(dialog(page)).toBeVisible();
      await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog(page)).toBeHidden();

      await openSettings(page, "Alerts");
      const box = await dialog(page).boundingBox();
      // A click on the backdrop, outside the dialog's box.
      await page.mouse.click(5, (box?.y ?? 100) + 10);
      await expect(dialog(page)).toBeHidden();
      // 007 FR-003: the 008–009 entries appear once their feature exists, after the shortcuts, in the PRD A6
      // order: Export and import (008), then Logs, Updates and About (009 FR-012).
      await openSettings(page, "Alerts");
      await expect(dialog(page).locator("section.sset > h3")).toHaveText([
        "Appearance",
        "Alerts",
        "Quick reschedule durations",
        "Keyboard shortcuts",
        "Export and import",
        // 018 FR-014: the two cleanups, between Export and import and Logs.
        "Automatic cleanup",
        "Logs",
        "Updates",
      ]);
    } finally {
      await app.close();
    }
  });

  test("opened from an inline edit, the edit is saved and focus returns to that card (CHK022)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Write report" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const card = taskCard(page, "Write report");
      await card.locator(".title").dblclick();
      const editor = page.getByRole("textbox", { name: "Write report" });
      await expect(editor).toBeFocused();
      await editor.fill("Write report now");
      await page.keyboard.press(`${MOD}+Comma`);
      await expect(dialog(page)).toBeVisible();
      await expect(taskCard(page, "Write report now")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest("li[data-id]")?.textContent ?? "")).toContain("Write report now");
    } finally {
      await app.close();
    }
  });

  test("every limit of the three settings: valid values apply at once, invalid ones show the message and change nothing (US1-3 to US1-5, SC-003)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Alerts");
      const A = "Default alert period";
      const R = "Re-blink interval";
      const T = "Reschedule tolerance";

      await setDuration(page, A, "0", "0", "59");
      await expect(group(page, A).locator("..")).toContainText("The minimum is 1 hour.");
      expect(await storedSetting(page, "alertPeriodMin")).toBe(1440);
      await setDuration(page, A, "0", "1", "0");
      await expect.poll(() => storedSetting(page, "alertPeriodMin")).toBe(60);
      await setDuration(page, A, "9999", "23", "59");
      await expect.poll(() => storedSetting(page, "alertPeriodMin")).toBe(14_399_999);
      // 016 FR-031: an over-maximum value becomes the maximum at once.
      await field(page, A, "Days").fill("10000");
      await expect(field(page, A, "Days")).toHaveValue("9999");
      await expect(group(page, A).locator("..")).not.toContainText("Allowed range");
      await field(page, A, "Days").fill("1.5");
      await expect(group(page, A).locator("..")).toContainText("Allowed range");

      await setDuration(page, R, "0", "0", "29");
      await expect(group(page, R).locator("..")).toContainText("Allowed range: 30m – 30d.");
      await setDuration(page, R, "0", "0", "30");
      await expect.poll(() => storedSetting(page, "reblinkIntervalMin")).toBe(30);
      // 016 FR-032: on a 30-day setting, minutes typed while days is 30 become 0.
      await setDuration(page, R, "30", "0", "1");
      await expect(field(page, R, "Minutes")).toHaveValue("0");
      await expect.poll(() => storedSetting(page, "reblinkIntervalMin")).toBe(43_200);

      await setDuration(page, T, "0", "0", "59");
      await expect(group(page, T).locator("..")).toContainText("The minimum is 1 hour.");
      // Empty fields count as 0.
      await setDuration(page, T, "", "2", "");
      await expect.poll(() => storedSetting(page, "rescheduleToleranceMin")).toBe(120);

      // Invalid input is dropped on close (US1-5).
      await setDuration(page, T, "0", "0", "5");
      await page.keyboard.press("Escape");
      await openSettings(page, "Alerts");
      await expect(field(page, T, "Hours")).toHaveValue("2");
      await expect(field(page, T, "Minutes")).toHaveValue("0");
    } finally {
      await app.close();
    }
  });

  test("a shorter default period makes a task stale on the next evaluation, and an open override popover shows it (US1-3, FR-008)", async () => {
    const dataDir = freshDataDir();
    const created = Date.now() - 90 * MIN;
    seedTasks(dataDir, [task({ titleMd: "Old task", createdAt: created, staleBaseAt: created })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await expect(taskCard(page, "Old task")).not.toHaveClass(/stale/);
      await openSettings(page, "Alerts");
      await setDuration(page, "Default alert period", "0", "1", "0");
      await page.keyboard.press("Escape");
      await expect(taskCard(page, "Old task")).toHaveClass(/stale/);

      const card = taskCard(page, "Old task");
      await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      await expect(page.getByRole("checkbox", { name: "Use the global default (1h)" })).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("a failed save puts the saved value back and shows Changes are not saved (FR-039, quickstart 24)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Alerts");
      await app.evaluate(() => {
        process.env["VESTA_FAULT"] = "save";
      });
      await setDuration(page, "Re-blink interval", "0", "5", "0");
      await expect(page.getByText("Changes are not saved")).toBeVisible();
      await expect(field(page, "Re-blink interval", "Hours")).toHaveValue("4");
      await showPane(page, "General");
      await dialog(page).getByText("Dark", { exact: true }).click();
      await expect(dialog(page).getByRole("radio", { name: "System" })).toBeChecked();
      await dialog(page).locator("#set-language").selectOption("fr");
      await expect(dialog(page).locator("#set-language")).toHaveValue("system");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    } finally {
      await app.close();
    }
  });
});

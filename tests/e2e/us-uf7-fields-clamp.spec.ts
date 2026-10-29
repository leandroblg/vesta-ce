/**
 * 016 User Story 8: duration fields that cannot go over, and "30 days" in every limit text (FR-031 to FR-034, SC-007;
 * PRD Q237, Q238).
 */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { HOUR, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings, setLanguage, showPane } from "./fixtures/settings";

const group = (page: Page, name: string) => dialog(page).getByRole("group", { name });
const field = (page: Page, setting: string, unit: "Days" | "Hours" | "Minutes") => group(page, setting).getByRole("spinbutton", { name: unit });

function stored(page: Page, key: string): Promise<number> {
  return page.evaluate(async (k) => {
    const r = await window.vesta.app.getInitialState();
    return r.ok ? ((r.value.alertSettings as unknown as Record<string, number>)[k] ?? -1) : -1;
  }, key);
}

test.describe("016 US8 — duration fields that cannot go over", () => {
  test("over-maximum values become the maximum at once; the 30-day rule; the alert period's 9999 days; the minimum keeps its error", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Alerts");
      const T = "Reschedule tolerance";
      await field(page, T, "Minutes").fill("75");
      await expect(field(page, T, "Minutes")).toHaveValue("59");
      await field(page, T, "Hours").fill("30");
      await expect(field(page, T, "Hours")).toHaveValue("23");
      await expect(group(page, T).locator("..")).not.toContainText("Allowed range");
      await field(page, T, "Days").fill("45");
      await expect(field(page, T, "Days")).toHaveValue("30");
      await expect(field(page, T, "Hours")).toHaveValue("0");
      await expect(field(page, T, "Minutes")).toHaveValue("0");
      await expect.poll(() => stored(page, "rescheduleToleranceMin")).toBe(43_200);
      await field(page, T, "Hours").fill("5");
      await expect(field(page, T, "Hours")).toHaveValue("0");

      const A = "Default alert period";
      await field(page, A, "Days").fill("45");
      await expect(field(page, A, "Days")).toHaveValue("45");
      await field(page, A, "Days").fill("12000");
      await expect(field(page, A, "Days")).toHaveValue("9999");
      await field(page, A, "Days").fill("0");
      await field(page, A, "Hours").fill("0");
      await field(page, A, "Minutes").fill("30");
      await expect(group(page, A).locator("..")).toContainText("The minimum is 1 hour.");

      for (const name of ["First", "Fourth"]) {
        await field(page, name, "Days").fill("31");
        await expect(field(page, name, "Days")).toHaveValue("30");
        await expect(field(page, name, "Hours")).toHaveValue("0");
      }
      await closeSettings(page);
    } finally {
      await app.close();
    }
  });

  test("the alert override and the details panel's override clamp the same way", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Override", position: 1, createdAt: Date.now() - HOUR })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      const card = taskCard(page, "Override");
      await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      const modal = page.getByRole("dialog", { name: "Alert override" });
      await modal.getByRole("checkbox").click();
      await modal.getByRole("spinbutton", { name: "Minutes" }).fill("99");
      await expect(modal.getByRole("spinbutton", { name: "Minutes" })).toHaveValue("59");
      await page.keyboard.press("Escape");
      await card.locator(".title").click();
      const panelHours = page.getByRole("complementary").getByRole("spinbutton", { name: "Hours" });
      await panelHours.fill("40");
      await expect(panelHours).toHaveValue("23");
    } finally {
      await app.close();
    }
  });

  for (const [value, lang] of [
    ["en", "en"],
    ["pt-BR", "pt-BR"],
    ["it", "it"],
    ["es-ES", "es-ES"],
    ["fr", "fr"],
  ] as const) {
    test(`no limit text says 720 hours in ${lang}; the range line writes 30 days (FR-034, SC-007)`, async () => {
      const { app, page } = await launchVesta();
      try {
        await setLanguage(page, value, lang);
        await showPane(page, "Alerts");
        await expect(page.locator("dialog.settings-dialog[open]")).not.toContainText("720");
        // The re-blink interval (the second duration group) under its minimum shows the range line, in days.
        await page.locator("dialog.settings-dialog[open]").locator("fieldset.dhm").nth(1).getByRole("spinbutton").nth(1).fill("0");
        await expect(page.locator("dialog.settings-dialog[open]")).toContainText(/30\s?(d|j|g|dias?)\b/);
        await expect(page.locator("dialog.settings-dialog[open]")).not.toContainText("720");
      } finally {
        await app.close();
      }
    });
  }
});

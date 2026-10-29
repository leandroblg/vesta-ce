import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminderList, reminderSection, reminderToggle } from "./fixtures/reminders";
import { reminder, seedReminders } from "./fixtures/seed";

function launchWith(texts: string[], env?: Record<string, string>) {
  const dataDir = freshDataDir();
  seedReminders(dataDir, texts.map((textMd, i) => reminder({ textMd, position: i + 1 })));
  return launchVesta({ dataDir, env });
}

test.describe("002 US5 — collapse the Reminders section", () => {
  test("expanded on first run (1)", async () => {
    const { app, page } = await launchVesta();
    try {
      await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(reminderList(page)).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("mouse, Enter and Space toggle it; collapsed keeps heading, count and toggle only (2, 4)", async () => {
    const { app, page } = await launchWith(["A", "B"]);
    try {
      await reminderToggle(page).click();
      await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(reminderList(page)).toHaveCount(0);
      await expect(reminderSection(page).getByRole("button", { name: /New reminder…/ })).toHaveCount(0);
      await expect(reminderSection(page).locator(".count")).toHaveText("2");
      await expect(reminderToggle(page)).toBeVisible();

      await reminderToggle(page).focus();
      await page.keyboard.press("Enter");
      await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(reminderList(page)).toBeVisible();
      await page.keyboard.press("Space");
      await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(reminderToggle(page)).toHaveAccessibleName(/^Reminders/);
    } finally {
      await app.close();
    }
  });

  test("the state survives a relaunch both ways (3, SC-006)", async () => {
    let run = await launchWith(["A"]);
    await reminderToggle(run.page).click();
    run = await relaunch(run);
    await expect(reminderToggle(run.page)).toHaveAttribute("aria-expanded", "false");
    await reminderToggle(run.page).click();
    run = await relaunch(run);
    try {
      await expect(reminderToggle(run.page)).toHaveAttribute("aria-expanded", "true");
    } finally {
      await run.app.close();
    }
  });

  test("a failed save keeps the section as it was and shows 'Changes are not saved' (FR-022)", async () => {
    const { app, page } = await launchWith(["A"], { VESTA_FAULT: "save" });
    try {
      await reminderToggle(page).click();
      await expect(page.getByTestId("notification")).toContainText("Changes are not saved");
      await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "true");
    } finally {
      await app.close();
    }
  });
});

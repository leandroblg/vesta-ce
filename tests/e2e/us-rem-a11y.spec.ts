import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures/axe";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminderCard, reminderList, reminderToggle } from "./fixtures/reminders";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";

for (const colorScheme of ["light", "dark"] as const) {
  test(`002 FR-023, SC-007: reminder views have no accessibility violations in ${colorScheme} mode`, async () => {
    test.setTimeout(90_000);
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [task({ titleMd: "Fix bike" })]);
    seedReminders(dataDir, [
      reminder({ textMd: "Call the bank", position: 1 }),
      reminder({ textMd: "Pick up dry cleaning", position: 2 }),
      reminder({ textMd: "Archived note", doneAt: now - DAY }),
      reminder({ textMd: "Trashed note", deletedAt: now - DAY }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ colorScheme });
      await expectNoA11yViolations(page, `${colorScheme}: Reminders expanded`);

      await reminderCard(page, "Call the bank").hover();
      await expect(reminderCard(page, "Call the bank").getByRole("button", { name: "Move to Trash" })).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: hover buttons`);

      await reminderCard(page, "Call the bank").locator(".title").dblclick();
      await expectNoA11yViolations(page, `${colorScheme}: reminder editor`);
      await page.keyboard.press("Escape");

      await reminderCard(page, "Pick up dry cleaning").getByRole("checkbox").click();
      await expect(page.getByTestId("notification")).toContainText(/moved to the Archive\./);
      await expectNoA11yViolations(page, `${colorScheme}: reminder undo notice`);

      await reminderToggle(page).click();
      await expect(reminderList(page)).toHaveCount(0);
      await expectNoA11yViolations(page, `${colorScheme}: Reminders collapsed`);

      await page.getByRole("button", { name: /^Archive/ }).click();
      await expectNoA11yViolations(page, `${colorScheme}: Archive with Reminders division`);
      await page.getByRole("button", { name: /^Trash/ }).click();
      await page.getByRole("button", { name: "Delete permanently: Trashed note" }).click();
      await expectNoA11yViolations(page, `${colorScheme}: Trash with Reminders division`);
    } finally {
      await app.close();
    }
  });
}

test("002 FR-007a: the 'Maximum reminders reached' card passes the scan in both themes", async () => {
  test.setTimeout(90_000);
  const dataDir = freshDataDir();
  seedReminders(dataDir, Array.from({ length: 200 }, (_, i) => reminder({ textMd: `R${String(i)}`, position: i + 1 })));
  const { app, page } = await launchVesta({ dataDir });
  try {
    await expect(reminderList(page).locator("li.max")).toBeVisible();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await expectNoA11yViolations(page, `${colorScheme}: maximum reminders card`);
    }
  } finally {
    await app.close();
  }
});

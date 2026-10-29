import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminderCard, reminderTexts, reminderToggle } from "./fixtures/reminders";
import { DAY, reminder, seedReminders, seedSetting } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";
import { backToTasks } from "./fixtures/nav";

const toast = (page: Page) => page.getByTestId("notification");
const division = (page: Page, name: "Tasks" | "Reminders") =>
  page.locator("section.division").filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^${name}`) }) });
const entry = (page: Page, text: string) =>
  division(page, "Reminders").locator(".arow").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });
const openView = (page: Page, view: "Archive" | "Trash") => page.getByRole("button", { name: new RegExp(`^${view}`) }).click();
const back = (page: Page) => backToTasks(page);

function launchWith(rows: ReturnType<typeof reminder>[], collapsed?: boolean) {
  const dataDir = freshDataDir();
  seedReminders(dataDir, rows);
  if (collapsed !== undefined) seedSetting(dataDir, "remindersCollapsed", collapsed);
  return launchVesta({ dataDir });
}

test.describe("002 US4 — restore reminders from Archive and Trash", () => {
  test("Archive: Reminders division above Tasks (014 PRD Q193), newest first, 'Done {date}' and Restore and Delete (1, 3; 018 FR-009)", async () => {
    const now = Date.now();
    const { app, page } = await launchWith([
      reminder({ textMd: "Older done", doneAt: now - 2 * DAY }),
      reminder({ textMd: "Newer done", doneAt: now - DAY }),
    ]);
    try {
      await openView(page, "Archive");
      const tasks = await division(page, "Tasks").boundingBox();
      const rems = await division(page, "Reminders").boundingBox();
      expect(tasks && rems && rems.y < tasks.y).toBe(true);
      await expect(division(page, "Reminders").locator(".count")).toHaveText("2");
      await expect(division(page, "Reminders").locator(".arow .title")).toHaveText(["Newer done", "Older done"]);
      await expect(entry(page, "Newer done").locator(".meta")).toContainText("Done ");
      // 018 FR-009: Restore and Delete.
      await expect(entry(page, "Newer done").getByRole("button")).toHaveCount(2);
      await expect(entry(page, "Newer done").getByRole("button", { name: "Restore: Newer done" })).toBeVisible();
      await expect(entry(page, "Newer done").getByRole("button", { name: "Delete “Newer done”" })).toBeVisible();
      await expect(division(page, "Tasks").getByText("Nothing here yet. Done items appear here and are kept for 10 years.")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("Trash: 'Reminder', date, days left, Restore and Delete permanently on a second click (2, 3, FR-016)", async () => {
    const now = Date.now();
    const { app, page } = await launchWith([
      reminder({ textMd: "Gone", deletedAt: now - 2 * DAY - 1000 }),
      reminder({ textMd: "Gone too", deletedAt: now - 1000 }),
    ]);
    try {
      await openView(page, "Trash");
      const trashTasks = await division(page, "Tasks").boundingBox();
      const trashRems = await division(page, "Reminders").boundingBox();
      expect(trashTasks && trashRems && trashRems.y < trashTasks.y).toBe(true);
      await expect(division(page, "Reminders").locator(".arow .title")).toHaveText(["Gone too", "Gone"]);
      const gone = entry(page, "Gone");
      await expect(gone.locator(".meta")).toContainText("Reminder · Deleted ");
      await expect(gone.locator(".days")).toHaveText("28 days left");
      await gone.getByRole("button", { name: "Delete permanently: Gone" }).click();
      await expect(gone.getByRole("button", { name: "Click again to delete: Gone" })).toBeVisible();
      await gone.getByRole("button", { name: "Click again to delete: Gone" }).click();
      await expect(entry(page, "Gone")).toHaveCount(0);
      await expect(toast(page)).toHaveCount(0); // permanent delete has no undo
      await expect(division(page, "Tasks").getByText("Trash is empty. Deleted items stay here for 30 days.")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("a deleted reminder appears in the Trash's Reminders division (US2 scenario 5)", async () => {
    const { app, page } = await launchWith([reminder({ textMd: "To delete" })]);
    try {
      await clickRevealed(reminderCard(page, "To delete"), reminderCard(page, "To delete").getByRole("button", { name: "Move to Trash" }));
      await openView(page, "Trash");
      await expect(entry(page, "To delete")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("restore returns it to its original position with 'Restored (undo)'; undo puts it back with its days left unchanged (4)", async () => {
    const now = Date.now();
    const a = reminder({ textMd: "A", position: 1 });
    const c = reminder({ textMd: "C", position: 2 });
    const b = reminder({ textMd: "B", position: 9, deletedAt: now - 3 * DAY - 1000, prevSiblingId: a.id, nextSiblingId: c.id });
    const d = reminder({ textMd: "D", position: 8, doneAt: now - DAY, prevSiblingId: c.id, nextSiblingId: null });
    const { app, page } = await launchWith([a, c, b, d]);
    try {
      await openView(page, "Trash");
      await entry(page, "B").getByRole("button", { name: "Restore: B" }).click();
      await expect(toast(page)).toContainText(/” restored\./);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(entry(page, "B").locator(".days")).toHaveText("27 days left");
      await entry(page, "B").getByRole("button", { name: "Restore: B" }).click();
      await back(page);
      expect(await reminderTexts(page)).toEqual(["A", "B", "C"]);

      await openView(page, "Archive");
      await entry(page, "D").getByRole("button", { name: "Restore: D" }).click();
      await back(page);
      expect(await reminderTexts(page)).toEqual(["A", "B", "C", "D"]);
    } finally {
      await app.close();
    }
  });

  test("with the section collapsed, a restore expands it for good; undoing that restore leaves it expanded (5, FR-018)", async () => {
    let run = await launchWith([reminder({ textMd: "Kept" }), reminder({ textMd: "Back", doneAt: Date.now() - DAY })], true);
    const { page } = run;
    await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "false");
    await openView(page, "Archive");
    await entry(page, "Back").getByRole("button", { name: "Restore: Back" }).click();
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await back(page);
    await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "true");
    expect(await reminderTexts(page)).toEqual(["Kept"]);

    await openView(page, "Archive");
    await entry(page, "Back").getByRole("button", { name: "Restore: Back" }).click();
    run = await relaunch(run);
    try {
      await expect(reminderToggle(run.page)).toHaveAttribute("aria-expanded", "true");
      expect(await reminderTexts(run.page)).toEqual(["Kept", "Back"]);
    } finally {
      await run.app.close();
    }
  });

  test("a reminder deleted 31 days ago is gone after launch; header counts include reminders (6, 7, FR-019, FR-020)", async () => {
    const now = Date.now();
    const { app, page } = await launchWith([
      reminder({ textMd: "Expired", deletedAt: now - 31 * DAY }),
      reminder({ textMd: "Recent", deletedAt: now - DAY }),
      reminder({ textMd: "Done", doneAt: now - DAY }),
    ]);
    try {
      await expect(page.getByRole("button", { name: /^Trash/ })).toContainText("1");
      await expect(page.getByRole("button", { name: /^Archive/ })).toContainText("1");
      await openView(page, "Trash");
      await expect(entry(page, "Expired")).toHaveCount(0);
      await expect(entry(page, "Recent")).toBeVisible();
    } finally {
      await app.close();
    }
  });
});

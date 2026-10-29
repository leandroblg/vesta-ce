// 010 US8 (PRD Q133; FR-033 to FR-035): a reminder to check for updates while automatic checks are off.
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { DAY, advanceClock } from "./fixtures/clock";
import { exportFolder, exportVia, importVia } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { tickUpdates, updateRequests } from "./fixtures/releases";
import { addTasks, seedTasks, task } from "./fixtures/seed";
import { closeSettings, openSettings } from "./fixtures/settings";

const notice = (page: Page) => page.getByTestId("notification");
const reminderNotice = (page: Page) => notice(page).and(page.locator("[data-kind='reminder']"));
const autoBox = (page: Page) => page.getByTestId("auto-update");
const reminderBox = (page: Page) => page.getByTestId("update-reminder");
const daysBox = (page: Page) => page.getByTestId("update-reminder-days");

function setting(dataDir: string, key: string): string | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}

test.describe("010 US8 — I am reminded to check for updates while automatic checks are off", () => {
  test("Q133 one reminder per period, no request, selecting it opens Settings at Updates; the period and switch apply at once", async () => {
    test.setTimeout(90_000);
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openSettings(page, "Updates");
      await expect(reminderBox(page)).toHaveCount(0); // automatic checks are on: no reminder controls
      await autoBox(page).click();
      await expect(autoBox(page)).not.toBeChecked();
      await expect(reminderBox(page)).toBeChecked();
      await expect(daysBox(page)).toHaveValue("30");
      await closeSettings(page);
      const requestsBefore = (await updateRequests(app)).length;

      await advanceClock(app, 30 * DAY - 60_000);
      await tickUpdates(app);
      await expect(reminderNotice(page)).toHaveCount(0);
      await advanceClock(app, 60_000);
      await tickUpdates(app);
      await expect(reminderNotice(page)).toContainText("Automatic update checks are off. Check for updates in Settings.");
      await tickUpdates(app);
      await expect(page.locator("[data-kind='reminder']")).toHaveCount(1);
      expect((await updateRequests(app)).length).toBe(requestsBefore);

      await notice(page).getByTestId("reminder-view").click();
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
      await expect(page.locator("#set-updates-h")).toBeFocused();
      await expect(reminderNotice(page)).toHaveCount(0);

      await daysBox(page).fill("7");
      await expect.poll(() => setting(dataDir, "updateReminderDays")).toBe("7");
      await closeSettings(page);
      await advanceClock(app, 7 * DAY);
      await tickUpdates(app);
      await expect(reminderNotice(page)).toBeVisible();
      await notice(page).getByRole("button", { name: "Close" }).click();

      await openSettings(page, "Updates");
      await reminderBox(page).click();
      await expect(reminderBox(page)).not.toBeChecked();
      await expect(daysBox(page)).toBeDisabled();
      await expect.poll(() => setting(dataDir, "updateReminder")).toBe("false");
      await closeSettings(page);
      await advanceClock(app, 365 * DAY);
      await tickUpdates(app);
      await expect(reminderNotice(page)).toHaveCount(0);

      await openSettings(page, "Updates");
      await autoBox(page).click();
      await expect(reminderBox(page)).toHaveCount(0);
      await closeSettings(page);
      await advanceClock(app, 365 * DAY);
      await tickUpdates(app);
      await expect(reminderNotice(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("Q133 the two reminder settings travel with an export and merge like the others", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir });
    const folder = exportFolder();
    const exported = await (async () => {
      try {
        await openSettings(page, "Updates");
        await autoBox(page).click();
        await daysBox(page).fill("90");
        await expect.poll(() => setting(dataDir, "updateReminderDays")).toBe("90");
        await reminderBox(page).click();
        await expect.poll(() => setting(dataDir, "updateReminder")).toBe("false");
        const text = await exportVia(app, page, folder);
        const name = /Saved (\S+\.zip)/.exec(text)?.[1];
        if (name === undefined) throw new Error(`export file name not found in: ${text}`);
        return join(folder, name);
      } finally {
        await app.close();
      }
    })();
    const other = freshDataDir();
    addTasks(other, [task({ titleMd: "Theirs" })]);
    const second = await launchVesta({ dataDir: other });
    try {
      expect(await importVia(second.app, second.page, exported)).toBe("merged");
      expect(setting(other, "updateReminderDays")).toBe("90");
      expect(setting(other, "updateReminder")).toBe("false");
    } finally {
      await second.app.close();
    }
  });
});

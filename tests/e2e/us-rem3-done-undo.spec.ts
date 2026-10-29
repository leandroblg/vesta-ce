import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { addReminder, newReminderEditor, reminderCard, reminderList, reminderSection, reminderTexts } from "./fixtures/reminders";
import { reminder, seedReminders, seedTasks, task, writeBackup } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";
import { backToTasks } from "./fixtures/nav";

const toast = (page: Page) => page.getByTestId("notification");
const taskCard = (page: Page, title: string) => page.locator("li[data-kind='task']").filter({ hasText: title });

/** Cmd/Ctrl+Z goes through the Edit menu's Undo item, as in the 001 specs. */
async function pressUndoShortcut(app: ElectronApplication) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.getMenuItemById("undo")?.click(undefined, BrowserWindow.getAllWindows()[0]);
  });
}

function launchWith(texts: string[], titles: string[] = []) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, titles.map((titleMd, i) => task({ titleMd, position: i + 1 })));
  seedReminders(dataDir, texts.map((textMd, i) => reminder({ textMd, position: i + 1 })));
  return launchVesta({ dataDir });
}

const tick = (page: Page, text: string) => reminderCard(page, text).getByRole("checkbox", { name: `Mark done: ${text}` }).click();

test.describe("002 US3 — tick a reminder done, with undo", () => {
  test("done moves it to the Archive with 'Moved to archive (undo)'; (undo) puts it back in the middle (1, 3)", async () => {
    const { app, page } = await launchWith(["A", "B", "C"]);
    try {
      await tick(page, "B");
      expect(await reminderTexts(page)).toEqual(["A", "C"]);
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(toast(page)).toHaveCount(0);
      await expect.poll(() => reminderTexts(page)).toEqual(["A", "B", "C"]);
    } finally {
      await app.close();
    }
  });

  test("Cmd/Ctrl+Z undoes a reminder done and a reminder delete (2, 3)", async () => {
    const { app, page } = await launchWith(["A", "B", "C"]);
    try {
      await tick(page, "B");
      await pressUndoShortcut(app);
      await expect.poll(() => reminderTexts(page)).toEqual(["A", "B", "C"]);

      await clickRevealed(reminderCard(page, "C"), reminderCard(page, "C").getByRole("button", { name: "Move to Trash" }));
      await expect(toast(page)).toContainText(/moved to the Trash\./);
      await pressUndoShortcut(app);
      await expect.poll(() => reminderTexts(page)).toEqual(["A", "B", "C"]);
    } finally {
      await app.close();
    }
  });

  test("disappears after 10 s even while hovered; hover-only close button (2)", async () => {
    test.setTimeout(40_000);
    const { app, page } = await launchWith(["A", "B"]);
    try {
      await tick(page, "A");
      const close = toast(page).getByRole("button", { name: "Close" });
      await page.mouse.move(0, 0);
      await expect(close).toHaveCSS("opacity", "0");
      await toast(page).hover();
      await expect(close).toHaveCSS("opacity", "1");
      await page.waitForTimeout(9_000);
      await expect(toast(page)).toBeVisible();
      await expect(toast(page)).toHaveCount(0, { timeout: 3_000 });
      await pressUndoShortcut(app);
      await page.waitForTimeout(300);
      expect(await reminderTexts(page)).toEqual(["B"]);
    } finally {
      await app.close();
    }
  });

  test("a reminder action replaces a task's notification and the reverse; only the latest is undone (2, FR-014)", async () => {
    const { app, page } = await launchWith(["Rem A", "Rem B"], ["Task A"]);
    try {
      await taskCard(page, "Task A").getByRole("checkbox").click();
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await tick(page, "Rem A");
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => reminderTexts(page)).toEqual(["Rem A", "Rem B"]);
      await expect(taskCard(page, "Task A")).toHaveCount(0); // the task's done was replaced, not undone

      await tick(page, "Rem B");
      await page.getByRole("button", { name: /^Archive/ }).click();
      await backToTasks(page);
      await page.getByRole("button", { name: "New task…" }).click();
      await page.getByRole("textbox", { name: "New task…" }).fill("Task B");
      await page.getByRole("textbox", { name: "New task…" }).press("Enter");
      await page.getByRole("textbox", { name: "New task…" }).press("Escape");
      await taskCard(page, "Task B").getByRole("checkbox").click();
      await pressUndoShortcut(app);
      await expect(taskCard(page, "Task B")).toHaveCount(1);
      expect(await reminderTexts(page)).toEqual(["Rem A"]); // the reminder's done stays
    } finally {
      await app.close();
    }
  });

  test("Cmd/Ctrl+Z inside a reminder editor or the reminders empty card undoes typing only (4)", async () => {
    const { app, page } = await launchWith(["A", "B"]);
    try {
      await tick(page, "A");
      await reminderCard(page, "B").locator(".title").dblclick();
      const editor = page.locator("li[data-kind='rem'] [role='textbox']");
      await editor.pressSequentially("xyz");
      await expect(editor).toHaveText("Bxyz");
      await pressUndoShortcut(app);
      await expect(editor).not.toHaveText("Bxyz");
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await editor.press("Escape");

      await reminderSection(page).getByRole("button", { name: "New reminder…" }).click();
      await newReminderEditor(page).pressSequentially("abc");
      await pressUndoShortcut(app);
      await expect(newReminderEditor(page)).not.toHaveText("abc");
      expect(await reminderTexts(page)).toEqual(["B"]); // the done of A is not undone
    } finally {
      await app.close();
    }
  });

  test("an open edit is saved before an item is ticked, in both directions (5)", async () => {
    const { app, page } = await launchWith(["Rem", "Other rem"], ["Task", "Other task"]);
    try {
      await taskCard(page, "Task").locator(".title").first().dblclick();
      await page.locator("li[data-kind='task'] [role='textbox']").fill("Task edited");
      await tick(page, "Other rem");
      await expect(taskCard(page, "Task edited")).toBeVisible();
      expect(await reminderTexts(page)).toEqual(["Rem"]);

      await reminderCard(page, "Rem").locator(".title").dblclick();
      await page.locator("li[data-kind='rem'] [role='textbox']").fill("Rem edited");
      await taskCard(page, "Other task").getByRole("checkbox").click();
      await expect.poll(() => reminderTexts(page)).toEqual(["Rem edited"]);
      await expect(taskCard(page, "Other task")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("while a sticky notice shows, a reminder done happens without an undo notification (001 FR-028)", async () => {
    const dataDir = freshDataDir();
    writeBackup(dataDir, [], Date.now() - 60_000);
    seedTasks(dataDir, []);
    writeFileSync(join(dataDir, "data.sqlite"), Buffer.alloc(4096, 7)); // corrupt: the backup is restored with a sticky notice
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(toast(page)).toContainText("restored from the backup");
      await addReminder(page, "During sticky");
      await newReminderEditor(page).press("Escape");
      await tick(page, "During sticky");
      expect(await reminderTexts(page)).toEqual([]);
      await expect(toast(page)).toContainText("restored from the backup");
      await expect(toast(page)).not.toContainText(/moved to the Archive\./);
    } finally {
      await app.close();
    }
  });

  test("at 200 active reminders, a done brings the empty card back and its undo brings the max card back (FR-007a)", async () => {
    const dataDir = freshDataDir();
    seedReminders(dataDir, Array.from({ length: 200 }, (_, i) => reminder({ textMd: `R${String(i)}`, position: i + 1 })));
    const { app, page } = await launchVesta({ dataDir });
    try {
      const max = reminderList(page).locator("li.max");
      await expect(max).toHaveText("Maximum reminders reached");
      await tick(page, "R0");
      await expect(max).toHaveCount(0);
      await expect(reminderSection(page).getByRole("button", { name: "New reminder…" })).toBeVisible();
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(max).toHaveText("Maximum reminders reached");
    } finally {
      await app.close();
    }
  });
});

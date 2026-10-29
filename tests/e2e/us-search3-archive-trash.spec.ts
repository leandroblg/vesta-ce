/** US3 — include the Archive and the Trash (006 quickstart 8–9; FR-008, FR-012, FR-016 to FR-019). */
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, reminder, seedReminders, seedSetting, seedTasks, task } from "./fixtures/seed";
import { elsewhereSection, highlights, search, searchBox, searchSettled } from "./fixtures/search";

const rows = (page: Page) => elsewhereSection(page).locator("li.arow");
const rowTitles = async (page: Page) => (await rows(page).locator(".title").allTextContents()).map((s) => s.trim());
const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());

test.describe("006 US3 — Archive and Trash matches", () => {
  test("the checkbox adds a section with exactly the done and deleted matches, newest first, with tags, dates and context (8)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const parent = task({ titleMd: "Trip report", doneAt: now - 3 * DAY });
    seedTasks(dataDir, [
      task({ titleMd: "Report active", position: 1 }),
      parent,
      task({ titleMd: "Report draft", parentId: parent.id, leftWithId: parent.id, doneAt: now - 3 * DAY, position: 1 }),
      task({ titleMd: "Old report", deletedAt: now - 28 * DAY }),
      task({ titleMd: "Unrelated done", doneAt: now - DAY }),
    ]);
    seedReminders(dataDir, [reminder({ textMd: "Send the report", doneAt: now - DAY })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "report");
      await expect(elsewhereSection(page)).toHaveCount(0);
      expect(await taskTitles(page)).toEqual(["Report active"]);
      await search(page, "report", { includeArchiveTrash: true });
      await expect(elsewhereSection(page)).toBeVisible();
      await expect(elsewhereSection(page).getByRole("heading", { level: 2, name: "Matches in Archive and Trash" })).toBeVisible();
      // Newest first; on equal dates the parent before the subtask that left with it.
      expect(await rowTitles(page)).toEqual(["Send the report", "Trip report", "Report draft", "Old report"]);
      const rem = rows(page).filter({ hasText: "Send the report" });
      await expect(rem).toContainText("Reminder");
      await expect(rem).toContainText("Archive");
      const sub = rows(page).filter({ hasText: "Report draft" });
      await expect(sub.locator(".ctx")).toContainText("Trip report");
      const trash = rows(page).filter({ hasText: "Old report" });
      await expect(trash).toContainText("Trash");
      await expect(trash).toContainText("2 days left");
      await expect(trash.getByRole("button", { name: "Restore: Old report" })).toBeVisible();
      // Highlighted in the section too (FR-012).
      expect((await highlights(page)).filter((h) => h.toLowerCase() === "report").length).toBeGreaterThanOrEqual(5);
      // Nothing matching: the section says so.
      await search(page, "zzzz", { includeArchiveTrash: true });
      await expect(elsewhereSection(page).getByText("No matches for “zzzz”.")).toBeVisible();
      // Ticked with an empty box: nothing extra.
      await searchBox(page).fill("");
      await expect(elsewhereSection(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("Restore and undo work as in the Archive and Trash views; done moves an item into the section (8)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Garden plan", position: 1 }), task({ titleMd: "Garden tools", deletedAt: Date.now() - DAY })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "garden", { includeArchiveTrash: true });
      await rows(page).filter({ hasText: "Garden tools" }).getByRole("button", { name: /^Restore/ }).click();
      await searchSettled(page);
      await expect(page.getByText(/” restored\./)).toBeVisible();
      expect(await rowTitles(page)).toEqual([]);
      expect((await taskTitles(page)).sort()).toEqual(["Garden plan", "Garden tools"]);
      await page.getByRole("button", { name: "Undo" }).click();
      await searchSettled(page);
      expect(await rowTitles(page)).toEqual(["Garden tools"]);
      // Marking a shown task done moves it into the section.
      await page.getByRole("checkbox", { name: /Garden plan/ }).click();
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual([]);
      expect(await rowTitles(page)).toContain("Garden plan");
    } finally {
      await app.close();
    }
  });

  test("a restore into a collapsed parent during a search leaves it expanded after clearing; undo collapses it again (9)", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Office admin", collapsed: true, position: 1 });
    seedTasks(dataDir, [
      parent,
      task({ titleMd: "Other sub", parentId: parent.id, position: 1 }),
      task({ titleMd: "Pay invoice", parentId: parent.id, position: 2, doneAt: Date.now() - DAY }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "invoice", { includeArchiveTrash: true });
      await rows(page).filter({ hasText: "Pay invoice" }).getByRole("button", { name: /^Restore/ }).click();
      await searchSettled(page);
      await searchBox(page).fill("");
      // Expanded by the restore (PRD Q88), not by the search.
      expect(await taskTitles(page)).toEqual(["Office admin", "Other sub", "Pay invoice"]);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect.poll(() => taskTitles(page)).toEqual(["Office admin"]);
    } finally {
      await app.close();
    }
  });

  test("a reminder restored during a search expands the collapsed Reminders section; undo leaves it expanded (FR-008, Q91)", async () => {
    const dataDir = freshDataDir();
    seedReminders(dataDir, [reminder({ textMd: "Water plants", position: 1 }), reminder({ textMd: "Call dentist", doneAt: Date.now() - DAY })]);
    seedSetting(dataDir, "remindersCollapsed", true);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "dentist", { includeArchiveTrash: true });
      await rows(page).filter({ hasText: "Call dentist" }).getByRole("button", { name: /^Restore/ }).click();
      await searchSettled(page);
      await searchBox(page).fill("");
      await expect(page.locator("li[data-kind='rem'] .title")).toHaveText(["Water plants", "Call dentist"]);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("li[data-kind='rem'] .title")).toHaveText(["Water plants"]);
    } finally {
      await app.close();
    }
  });
});

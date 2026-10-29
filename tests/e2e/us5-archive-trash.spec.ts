import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";
import { backToTasks } from "./fixtures/nav";
import { selectedTitle } from "./fixtures/settings";

const activeTitles = (page: Page) => page.locator("li[data-kind='task'] .title");
const entry = (page: Page, title: string) =>
  page.locator(".arow").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const toast = (page: Page) => page.getByTestId("notification");

async function seedAndLaunch() {
  const dataDir = freshDataDir();
  const now = Date.now();
  const parent = task({ titleMd: "Prepare report", position: 2 });
  const renew = task({ titleMd: "Renew passport", position: 1 });
  seedTasks(dataDir, [
    renew,
    parent,
    task({ titleMd: "Gather numbers", parentId: parent.id, position: 1 }),
    task({ titleMd: "Draft summary", parentId: parent.id, position: 2 }),
    task({ titleMd: "Fix bike", position: 3 }),
    task({ titleMd: "Old trash", position: 9, deletedAt: now - 31 * DAY }),
    task({ titleMd: "Recent trash", position: 8, deletedAt: now - 2 * DAY - 1000 }),
  ]);
  return launchVesta({ dataDir });
}

test.describe("US5 — Archive and Trash", () => {
  test("header counts, views, back control; expired Trash rows are purged at launch (1, 8)", async () => {
    const { app, page } = await seedAndLaunch();
    try {
      await expect(page.getByRole("button", { name: /^Archive/ })).toContainText("0");
      await expect(page.getByRole("button", { name: /^Trash/ })).toContainText("1"); // "Old trash" purged at launch
      await page.getByRole("button", { name: /^Trash/ }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Trash" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Trash/ })).toHaveAttribute("aria-pressed", "true");
      await expect(entry(page, "Old trash")).toHaveCount(0);
      await expect(entry(page, "Recent trash")).toContainText("28 days left");
      await backToTasks(page);
      await expect(activeTitles(page).first()).toHaveText("Renew passport");
    } finally {
      await app.close();
    }
  });

  test("Archive lists done items with dates, taken-along subtasks and parent context; empty message (2, 3)", async () => {
    const { app, page } = await seedAndLaunch();
    try {
      await page.getByRole("button", { name: /^Archive/ }).click();
      // Scoped to the Tasks division: since 002 the Reminders division shows the same empty message.
      await expect(page.locator("section[aria-labelledby='archive-tasks-h']").getByText("Nothing here yet. Done items appear here and are kept for 10 years.")).toBeVisible();
      await backToTasks(page);

      await page.locator("li[data-kind='task']").filter({ hasText: "Gather numbers" }).getByRole("checkbox").click();
      await page.locator("li[data-kind='task']").filter({ hasText: "Prepare report" }).getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await expect(page.getByRole("button", { name: /^Archive/ })).toContainText("3");
      const rows = page.locator(".arow .title");
      await expect(rows).toHaveText(["Prepare report", "Draft summary", "Gather numbers"]);
      await expect(entry(page, "Draft summary")).toHaveClass(/\bsub\b/);
      await expect(entry(page, "Gather numbers").locator(".ctx")).toHaveText("Prepare report ›");
      await expect(entry(page, "Prepare report").locator(".meta")).toContainText("Done");
      // Restore (FR-032) and, from 018 (PRD Q272), Delete.
      await expect(entry(page, "Prepare report").getByRole("button")).toHaveText(["Restore", "Delete"]);
    } finally {
      await app.close();
    }
  });

  test("restore returns items to their place; a lone subtask comes back top-level; Restored (undo) (5, 6, 9)", async () => {
    const { app, page } = await seedAndLaunch();
    try {
      await page.locator("li[data-kind='task']").filter({ hasText: "Prepare report" }).getByRole("checkbox").click();
      await page.waitForTimeout(100);
      await page.getByRole("button", { name: /^Archive/ }).click();

      // A subtask that went with its parent, restored alone → top-level at the end.
      await entry(page, "Gather numbers").getByRole("button", { name: "Restore: Gather numbers" }).click();
      await expect(toast(page)).toContainText(/” restored\./);
      await backToTasks(page);
      await expect(activeTitles(page)).toHaveText(["Renew passport", "Fix bike", "Gather numbers"]);

      // The parent comes back between its old neighbours with the subtask still with it.
      await page.getByRole("button", { name: /^Archive/ }).click();
      await entry(page, "Prepare report").getByRole("button", { name: "Restore: Prepare report" }).click();
      await backToTasks(page);
      await expect(activeTitles(page)).toHaveText(["Renew passport", "Prepare report", "Draft summary", "Fix bike", "Gather numbers"]);
    } finally {
      await app.close();
    }
  });

  test("undoing a restore sends it back to the Trash with the same days left (9)", async () => {
    const { app, page } = await seedAndLaunch();
    try {
      await page.getByRole("button", { name: /^Trash/ }).click();
      await entry(page, "Recent trash").getByRole("button", { name: "Restore: Recent trash" }).click();
      await expect(toast(page)).toContainText(/” restored\./);
      await expect(entry(page, "Recent trash")).toHaveCount(0);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(entry(page, "Recent trash")).toContainText("28 days left");
    } finally {
      await app.close();
    }
  });

  test("Trash shows kind and days left; Delete permanently needs a second click (4, 7)", async () => {
    const { app, page } = await seedAndLaunch();
    try {
      const card = page.locator("li[data-kind='task']").filter({ hasText: "Prepare report" });
      await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await page.getByRole("button", { name: /^Trash/ }).click();
      await expect(entry(page, "Prepare report").locator(".meta")).toContainText("Task");
      await expect(entry(page, "Prepare report")).toContainText("30 days left");
      await expect(entry(page, "Gather numbers")).toHaveClass(/\bsub\b/);

      const del = entry(page, "Prepare report").getByRole("button", { name: /Delete permanently/ });
      await del.click();
      await expect(entry(page, "Prepare report").getByRole("button", { name: /Click again to delete/ })).toBeVisible();
      await entry(page, "Prepare report").getByRole("button", { name: /Click again to delete/ }).click();
      await expect(entry(page, "Prepare report")).toHaveCount(0);
      await expect(entry(page, "Gather numbers")).toHaveCount(0);
      await backToTasks(page);
      await expect(activeTitles(page)).toHaveText(["Renew passport", "Fix bike"]);
    } finally {
      await app.close();
    }
  });

  test("014 FR-007 FR-008 (PRD Q193): Reminders above Tasks in both views; the arrow keys walk the reminders first and cross into the tasks; Restore works from each (T020)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [
      task({ titleMd: "Done task", doneAt: now - 2000 }),
      task({ titleMd: "Gone task", deletedAt: now - 2000 }),
    ]);
    seedReminders(dataDir, [
      reminder({ textMd: "Done rem", doneAt: now - 1000 }),
      reminder({ textMd: "Gone rem", deletedAt: now - 1000 }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    const heads = () => page.locator("section.division h2").evaluateAll((hs) => hs.map((h) => h.textContent.replace(/\d+$/, "").trim()));
    const selected = () => selectedTitle(page);
    try {
      for (const view of ["Archive", "Trash"] as const) {
        await page.getByRole("button", { name: new RegExp(`^${view}`) }).click();
        expect(await heads()).toEqual(["Reminders", "Tasks"]);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press("ArrowDown");
        await expect.poll(selected).toBe(view === "Archive" ? "Done rem" : "Gone rem");
        await page.keyboard.press("ArrowDown");
        await expect.poll(selected).toBe(view === "Archive" ? "Done task" : "Gone task");
        await page.keyboard.press("ArrowUp");
        await expect.poll(selected).toBe(view === "Archive" ? "Done rem" : "Gone rem");
      }
      // Restore from each division of the Trash.
      await entry(page, "Gone rem").getByRole("button", { name: /^Restore/ }).click();
      await expect(entry(page, "Gone rem")).toHaveCount(0);
      await entry(page, "Gone task").getByRole("button", { name: /^Restore/ }).click();
      await expect(entry(page, "Gone task")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("014 FR-008 with no reminders, Down selects the first task (T020 c)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Only task", doneAt: Date.now() - 1000 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => selectedTitle(page)).toBe("Only task");
    } finally {
      await app.close();
    }
  });
});

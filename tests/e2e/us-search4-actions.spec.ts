/** US4 — searching does not disturb the list (006 quickstart 10–12, 17, 17a, 17b; FR-004c, FR-005a, FR-009, FR-011, FR-023, FR-025). */
import { expect, test, type Page } from "@playwright/test";
import { blinkLog, clearBlinkLog, recordBlinks, taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, tick } from "./fixtures/clock";
import { dragTo, readTitles } from "./fixtures/drag";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedReminders, seedSearchSet, seedTasks, staleTask, task } from "./fixtures/seed";
import { exactPhraseToggle, search, searchBox, searchSettled } from "./fixtures/search";

const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());
const blinksOn = async (page: Page, id: string) => (await blinkLog(page)).filter((b) => b.id === id).map((b) => b.blinks);
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

test.describe("006 US4 — searching does not disturb the list", () => {
  test("no drag starts and no Alt key moves anything while searching; a drag in progress is cancelled; both work after clearing (10)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Alpha one", position: 1 }), task({ titleMd: "Beta one", position: 2 }), task({ titleMd: "Gamma two", position: 3 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "one");
      expect(await dragTo(page, taskCard(page, "Beta one"), { row: taskCard(page, "Alpha one"), zone: "upper" })).toBeNull();
      await expect(taskCard(page, "Alpha one").locator(".grip")).toHaveCSS("cursor", "default");
      await taskCard(page, "Beta one").getByRole("checkbox").focus();
      await page.keyboard.press("Alt+ArrowUp");
      await page.waitForTimeout(200);
      expect(await taskTitles(page)).toEqual(["Alpha one", "Beta one"]);
      // A drag in progress when a search starts is cancelled.
      await searchBox(page).fill("");
      const grip = taskCard(page, "Gamma two").locator(".grip");
      const box = await grip.boundingBox();
      if (box === null) throw new Error("no grip");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y - 60, { steps: 6 });
      await searchBox(page).fill("a");
      await page.mouse.up();
      await searchBox(page).fill("");
      expect(await readTitles(page)).toEqual(["Alpha one", "Beta one", "Gamma two"]);
      // After clearing, dragging works again.
      expect(await dragTo(page, taskCard(page, "Gamma two"), { row: taskCard(page, "Alpha one"), zone: "upper" })).not.toBeNull();
      expect(await readTitles(page)).toEqual(["Gamma two", "Alpha one", "Beta one"]);
    } finally {
      await app.close();
    }
  });

  test("edited and new items stay shown until the text or a toggle changes; a done item leaves (11)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Write report", position: 1 }), task({ titleMd: "Report expenses", position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "report");
      // Edit a shown title so it no longer matches.
      await taskCard(page, "Write report").locator(".title").dblclick();
      const editor = page.getByRole("textbox", { name: "Write report" });
      await editor.press("ControlOrMeta+a");
      await editor.pressSequentially("Write summary");
      await editor.press("Enter");
      await searchSettled(page);
      // Add a task that does not match from the empty card.
      await page.getByRole("button", { name: "New task…" }).click();
      await page.keyboard.type("Buy milk");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual(["Write summary", "Report expenses", "Buy milk"]);
      // A toggle change releases them.
      await exactPhraseToggle(page).click();
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual(["Report expenses"]);
      // Marking done: it leaves at once.
      await taskCard(page, "Report expenses").getByRole("checkbox").click();
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("Reschedule, Alert override, Add subtask, the panel, delete and undo, and the 200-reminder card work during a search (FR-009)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [staleTask({ titleMd: "Old project", position: 1 }), task({ titleMd: "Project plan", position: 2 })]);
    seedReminders(dataDir, Array.from({ length: 200 }, (_, i) => reminder({ textMd: `Project reminder ${String(i)}`, position: i + 1 })));
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "project");
      await expect(page.getByText("Maximum reminders reached")).toBeVisible();
      // Reschedule on the stale match.
      await taskCard(page, "Old project").hover();
      await taskCard(page, "Old project").getByRole("button", { name: "Reschedule" }).click();
      await expect(taskCard(page, "Old project")).not.toHaveClass(/\bstale\b/);
      // Alert override modal.
      await taskCard(page, "Project plan").hover();
      await taskCard(page, "Project plan").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      await expect(page.getByRole("checkbox", { name: /^Use the global default/ })).toBeVisible();
      await page.keyboard.press("Escape");
      // Add subtask: the new subtask stays shown.
      await taskCard(page, "Project plan").hover();
      await taskCard(page, "Project plan").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "New Subtask" }).click();
      await page.keyboard.type("Call the venue");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Escape");
      await searchSettled(page);
      expect(await taskTitles(page)).toContain("Call the venue");
      // The panel opens and saves details; the new word is findable after the save (FR-025, quickstart 17).
      await taskCard(page, "Project plan").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      await panel(page).getByRole("textbox", { name: "Details" }).click();
      await page.keyboard.type("zebracorn");
      await expect(panel(page).locator(".saved")).toBeVisible();
      await page.keyboard.press("Escape");
      await search(page, "zebracorn");
      expect(await taskTitles(page)).toEqual(["Project plan"]);
      // Delete and undo.
      await taskCard(page, "Project plan").hover();
      await taskCard(page, "Project plan").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual([]);
      await page.getByRole("button", { name: "Undo" }).click();
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual(["Project plan"]);
    } finally {
      await app.close();
    }
  });

  test("no blink plays during a search; what went stale or came due blinks after clearing (12, FR-005a)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const row = task({ titleMd: "Waiting", createdAt: now, updatedAt: now });
    seedTasks(dataDir, [row]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.waitForFunction(() => Number(document.documentElement.dataset["alertTicks"] ?? "0") > 0);
      await recordBlinks(page);
      await search(page, "wait");
      await advanceClock(app, DAY + MIN);
      await tick(page);
      // Light red and stale, but no blink while searching.
      await expect(taskCard(page, "Waiting")).toHaveClass(/\bstale\b/);
      await page.waitForTimeout(300);
      await expect(page.locator("li[data-kind='task'].blink")).toHaveCount(0);
      expect(await blinksOn(page, row.id)).toEqual([]);
      await searchBox(page).fill("");
      await expect.poll(() => blinksOn(page, row.id)).toEqual([1]);
      // A re-blink that comes due during a search plays once after clearing.
      await waitBlinksDone(page);
      await clearBlinkLog(page);
      await search(page, "wait");
      await advanceClock(app, 4 * HOUR + MIN);
      await tick(page);
      await page.waitForTimeout(300);
      expect(await blinksOn(page, row.id)).toEqual([]);
      await searchBox(page).fill("");
      await expect.poll(() => blinksOn(page, row.id)).toEqual([3]);
    } finally {
      await app.close();
    }
  });

  test("the first start after the update shows 'Preparing search…', then complete results, never a partial list (17a)", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir, { version: 4 });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await searchBox(page).fill("quarterly");
      // The visible status under the box (the screen-reader announcement is a separate, hidden copy).
      await expect(page.locator(".search-status")).toHaveText("Preparing search…");
      await searchSettled(page);
      await expect(page.locator(".search-status")).toHaveCount(0);
      const first = (await taskTitles(page)).length;
      expect(first).toBeGreaterThan(0);
      // The same search again gives the same, complete list.
      await searchBox(page).fill("quarterl");
      await searchSettled(page);
      await searchBox(page).fill("quarterly");
      await searchSettled(page);
      expect((await taskTitles(page)).length).toBe(first);
    } finally {
      await app.close();
    }
  });

  test("details over 100,000 characters save at once and are found after background indexing (17b)", async () => {
    const dataDir = freshDataDir();
    const big = task({ titleMd: "Big notes", position: 1 });
    seedTasks(dataDir, [big]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      // Saved through the same call the panel makes (pasting 300,000 characters into the editor would only
      // measure the editor).
      const ms = await page.evaluate(async (id) => {
        const text = `${"A line of **notes** with a [link](https://x.example).\n\n".repeat(5_000)}uniqueword`;
        const t0 = performance.now();
        const r = await window.vesta.tasks.editDetails({ id, details: text });
        if (!r.ok) throw new Error(r.error.message);
        return performance.now() - t0;
      }, big.id);
      expect(ms).toBeLessThan(500);
      await searchBox(page).fill("uniqueword");
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual(["Big notes"]);
    } finally {
      await app.close();
    }
  });
});

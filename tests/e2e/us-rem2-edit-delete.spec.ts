import { expect, test, type Page } from "@playwright/test";
import { IS_MAC } from "./fixtures/settings";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminderCard, reminderCards, reminderTexts } from "./fixtures/reminders";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";

const remEditor = (page: Page) => page.locator("li[data-kind='rem'] [role='textbox']");
const taskCard = (page: Page, title: string) => page.locator("li[data-kind='task']").filter({ hasText: title });
const taskEditor = (page: Page) => page.locator("li[data-kind='task'] [role='textbox']");

function launchWith(texts: string[], titles: string[] = []) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, titles.map((titleMd, i) => task({ titleMd, position: i + 1 })));
  seedReminders(dataDir, texts.map((textMd, i) => reminder({ textMd, position: i + 1 })));
  return launchVesta({ dataDir });
}

test.describe("002 US2 — edit and remove reminders from the card", () => {
  test("hover and keyboard focus show exactly Edit and Delete ('Move to Trash'), no menu button (1, FR-009, FR-024)", async () => {
    const { app, page } = await launchWith(["Call the bank"]);
    try {
      const card = reminderCard(page, "Call the bank");
      await card.hover();
      const buttons = card.locator(".actions button");
      await expect(buttons).toHaveCount(2);
      await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
      const del = card.getByRole("button", { name: "Move to Trash" });
      await expect(del).toBeVisible();
      await expect(del).toHaveAttribute("title", "Move to Trash");
      await expect(card.getByRole("button", { name: "More actions" })).toHaveCount(0);

      await page.mouse.move(0, 0);
      await card.getByRole("checkbox").focus();
      await page.keyboard.press("Tab");
      await expect(card.getByRole("button", { name: "Edit" })).toBeFocused();
      await expect(card.getByRole("button", { name: "Move to Trash" })).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("double-click and Edit open the inline editor with the hint; Enter and click outside save (2, 3)", async () => {
    let run = await launchWith(["Pick up dry cleaning"]);
    const { page } = run;
    await reminderCard(page, "Pick up dry cleaning").locator(".title").dblclick();
    await expect(remEditor(page)).toBeFocused();
    await expect(remEditor(page)).toHaveAccessibleName("Pick up dry cleaning");
    await expect(page.getByText(`${IS_MAC ? "Return" : "Enter"} to save · Esc to cancel`)).toBeVisible();
    await remEditor(page).fill("Pick up the dry cleaning");
    await remEditor(page).press("Enter");
    await expect(reminderCard(page, "Pick up the dry cleaning")).toBeVisible();

    await clickRevealed(reminderCard(page, "Pick up the dry cleaning"), reminderCard(page, "Pick up the dry cleaning").getByRole("button", { name: "Edit" }));
    // Under load the editor can still be mounting; fill once it holds the text, so the fill replaces it.
    await expect(remEditor(page)).toBeFocused();
    await expect(remEditor(page)).toHaveText("Pick up the dry cleaning");
    await remEditor(page).fill("Pick up the shirts\nand the coat");
    await page.locator("header").click();
    await expect(reminderCard(page, "Pick up the shirts and the coat")).toBeVisible();

    run = await relaunch(run);
    try {
      expect(await reminderTexts(run.page)).toEqual(["Pick up the shirts and the coat"]);
    } finally {
      await run.app.close();
    }
  });

  test("Esc discards; empty text restores the last saved text (3)", async () => {
    const { app, page } = await launchWith(["Water the plants"]);
    try {
      await reminderCard(page, "Water the plants").locator(".title").dblclick();
      await remEditor(page).fill("Something else");
      await remEditor(page).press("Escape");
      expect(await reminderTexts(page)).toEqual(["Water the plants"]);

      await reminderCard(page, "Water the plants").locator(".title").dblclick();
      await remEditor(page).fill("   ");
      await remEditor(page).press("Enter");
      await expect(remEditor(page)).toHaveCount(0);
      expect(await reminderTexts(page)).toEqual(["Water the plants"]);
    } finally {
      await app.close();
    }
  });

  test("closing the window mid-edit saves the typed text (3, 001 FR-018)", async () => {
    const run = await launchWith(["Book dentist"]);
    await reminderCard(run.page, "Book dentist").locator(".title").dblclick();
    await remEditor(run.page).fill("Book the dentist");
    const exited = new Promise<void>((done) => run.app.process().once("exit", () => { done(); }));
    await run.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    if (process.platform === "darwin") {
      await expect.poll(() => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
      await run.app.close();
    } else {
      await exited;
    }
    const next = await launchVesta({ dataDir: run.dataDir });
    try {
      expect(await reminderTexts(next.page)).toEqual(["Book the dentist"]);
    } finally {
      await next.app.close();
    }
  });

  test("a single click on the text opens nothing (4, FR-005)", async () => {
    const { app, page } = await launchWith(["Just a note"]);
    try {
      await reminderCard(page, "Just a note").locator(".title").click();
      await expect(remEditor(page)).toHaveCount(0);
      await expect(page.locator("aside, [role='dialog'], [role='menu']")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("Delete moves it to the Trash at once, with no confirmation, and shows 'Moved to trash (undo)' (5, FR-012)", async () => {
    const { app, page } = await launchWith(["A", "B", "C"]);
    try {
      await clickRevealed(reminderCard(page, "B"), reminderCard(page, "B").getByRole("button", { name: "Move to Trash" }));
      expect(await reminderTexts(page)).toEqual(["A", "C"]);
      await expect(page.getByTestId("notification")).toContainText(/moved to the Trash\./);
      await expect(page.getByTestId("notification").getByRole("button", { name: "Undo" })).toBeVisible();
      // The Trash's Reminders division arrives in US4; us-rem4-archive-trash.spec.ts checks the row there.
    } finally {
      await app.close();
    }
  });

  test("starting a reminder edit saves an open task edit first, and the reverse (edge case, one editor at a time)", async () => {
    const { app, page } = await launchWith(["Rem"], ["Task"]);
    try {
      await taskCard(page, "Task").locator(".title").dblclick();
      await taskEditor(page).fill("Task edited");
      await reminderCard(page, "Rem").locator(".title").dblclick();
      await expect(taskCard(page, "Task edited")).toBeVisible();
      await expect(remEditor(page)).toBeFocused();
      await expect(taskEditor(page)).toHaveCount(0);

      await remEditor(page).fill("Rem edited");
      // Closing the reminder editor removes its hint line, so the task card moves up between the two
      // clicks of a double-click (as between two tasks in 001); start the task edit by keyboard instead.
      await taskCard(page, "Task edited").getByRole("button", { name: "Edit" }).focus();
      await page.keyboard.press("Enter");
      await expect(reminderCard(page, "Rem edited")).toBeVisible();
      await expect(taskEditor(page)).toBeFocused();
      await expect(remEditor(page)).toHaveCount(0);
      expect(await reminderCards(page).count()).toBe(1);
    } finally {
      await app.close();
    }
  });
});

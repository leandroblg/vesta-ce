// 018 US3 (FR-009 to FR-013, AC1–AC7, SC-003; PRD Q272, Q281): an Archive entry goes to the Trash with its completion
// date and the subtasks that went with it, by its Delete button, Delete/Backspace, the context menu or Edit › Move to
// Trash; Undo puts it back, and a restore from the Trash returns it to the Archive.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { confirmRequests, nextConfirm } from "./fixtures/files";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, waitMenuState } from "./fixtures/menu";
import { backToTasks } from "./fixtures/nav";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { MOD } from "./fixtures/settings";

const NOW = Date.now();
const toast = (page: Page) => page.getByTestId("notification");
const panel = (page: Page) => page.getByTestId("details-panel");
const openView = (page: Page, view: "Archive" | "Trash") => page.getByRole("button", { name: new RegExp(`^${view}`) }).click();
const row = (page: Page, title: string) => page.locator("li.arow").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const setFault = (app: ElectronApplication, value: string) =>
  app.evaluate((_electron, v) => {
    process.env["VESTA_FAULT"] = v;
  }, value);

function seed() {
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Paint fence", doneAt: NOW - DAY, position: 1 });
  const s1 = task({ titleMd: "Buy paint", parentId: parent.id, doneAt: NOW - DAY, leftWithId: parent.id, position: 1 });
  const s2 = task({ titleMd: "Sand boards", parentId: parent.id, doneAt: NOW - 2 * DAY, leftWithId: parent.id, position: 2 });
  const host = task({ titleMd: "Garden", position: 2 });
  const lone = task({ titleMd: "Water roses", parentId: host.id, doneAt: NOW - 3 * DAY, position: 1 });
  seedTasks(dataDir, [parent, s1, s2, host, lone]);
  seedReminders(dataDir, [reminder({ textMd: "Call mom", doneAt: NOW - DAY })]);
  return dataDir;
}

const doneOn = (page: Page, title: string) => row(page, title).locator(".meta").textContent();

test.describe("018 US3 — Archive delete", () => {
  test("(a) (b) (c) the Delete button sends the parent and its group to the Trash with Done on kept; Undo brings them back", async () => {
    const { app, page } = await launchVesta({ dataDir: seed() });
    try {
      await openView(page, "Archive");
      // (a) top entries have Delete after Restore; taken-along subtasks have Restore only.
      const buttons = row(page, "Paint fence").getByRole("button");
      await expect(buttons).toHaveText(["Restore", "Delete"]);
      await expect(row(page, "Paint fence").locator("[data-ctl='delete']")).toHaveAccessibleName("Delete “Paint fence”");
      await expect(row(page, "Buy paint").locator("[data-ctl='delete']")).toHaveCount(0);
      await expect(row(page, "Water roses").locator("[data-ctl='delete']")).toHaveCount(1);
      const before = { p: await doneOn(page, "Paint fence"), s: await doneOn(page, "Sand boards") };
      // (b)
      await row(page, "Paint fence").locator("[data-ctl='delete']").click();
      await expect(toast(page)).toContainText("“Paint fence” moved to the Trash.");
      await expect(row(page, "Paint fence")).toHaveCount(0);
      await expect(row(page, "Buy paint")).toHaveCount(0);
      await openView(page, "Trash");
      await expect(page.locator("li.arow.sub .title")).toHaveText(["Buy paint", "Sand boards"]);
      await expect(row(page, "Paint fence").locator(".days")).toHaveText("30 days left");
      await row(page, "Paint fence").locator(".title").click();
      await expect(panel(page)).toContainText("Done ");
      await expect(panel(page)).toContainText("Deleted ");
      await page.keyboard.press("Escape");
      // (c) Undo from the notification.
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await openView(page, "Archive");
      await expect(row(page, "Paint fence")).toHaveCount(1);
      expect(await doneOn(page, "Paint fence")).toBe(before.p);
      expect(await doneOn(page, "Sand boards")).toBe(before.s);
      // (c) and Cmd/Ctrl+Z.
      await row(page, "Paint fence").locator("[data-ctl='delete']").click();
      await expect(row(page, "Paint fence")).toHaveCount(0);
      await page.keyboard.press(`${MOD}+z`);
      await expect(row(page, "Paint fence")).toHaveCount(1);
      await expect(toast(page).getByRole("button", { name: "Redo" })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("(d) Delete/Backspace, the context menu and Edit › Move to Trash do the same; (e) Restore from the Trash returns to the Archive", async () => {
    const { app, page } = await launchVesta({ dataDir: seed() });
    try {
      await openView(page, "Archive");
      await row(page, "Call mom").focus();
      await waitMenuState(app, "trash", { enabled: true });
      await page.keyboard.press("Backspace");
      await expect(toast(page)).toContainText("“Call mom” moved to the Trash.");
      await expect(row(page, "Call mom")).toHaveCount(0);
      // The lone subtask by right-click › Move to Trash; its parent stays active.
      await row(page, "Water roses").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await expect(row(page, "Water roses")).toHaveCount(0);
      // The parent through Edit › Move to Trash.
      await row(page, "Paint fence").focus();
      await clickMenu(app, "trash");
      await expect(row(page, "Paint fence")).toHaveCount(0);
      await backToTasks(page);
      await expect(page.locator("li[data-kind='task'] .title", { hasText: "Garden" })).toHaveCount(1);
      // (e) Restore in the Trash puts the group back in the Archive with its Done on.
      await openView(page, "Trash");
      await row(page, "Paint fence").getByRole("button", { name: /^Restore/ }).click();
      await openView(page, "Archive");
      await expect(row(page, "Paint fence")).toHaveCount(1);
      await expect(page.locator("li.arow.sub .title")).toHaveText(["Buy paint", "Sand boards"]);
      await expect(row(page, "Paint fence").locator(".meta")).toContainText("Done ");
    } finally {
      await app.close();
    }
  });

  test("(f) in the Trash Backspace still asks for Delete Permanently; (g) a delete closes the panel on that entry", async () => {
    const { app, page } = await launchVesta({ dataDir: seed() });
    try {
      await openView(page, "Archive");
      await row(page, "Paint fence").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      await row(page, "Paint fence").locator("[data-ctl='delete']").click();
      await expect(panel(page)).toBeHidden();
      await openView(page, "Trash");
      await row(page, "Paint fence").focus();
      await nextConfirm(app, false);
      await page.keyboard.press("Backspace");
      await expect.poll(async () => (await confirmRequests(app)).length).toBeGreaterThan(0);
      await expect(row(page, "Paint fence")).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test("(j) T088 a taken-along subtask deleted alone, then its parent, which takes the rest; Undo after a delete from an open panel does not reopen it", async () => {
    const { app, page } = await launchVesta({ dataDir: seed() });
    try {
      await openView(page, "Archive");
      await row(page, "Buy paint").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await expect(toast(page)).toContainText("“Buy paint” moved to the Trash.");
      await expect(row(page, "Buy paint")).toHaveCount(0);
      await expect(row(page, "Sand boards")).toHaveCount(1);
      // The parent, with its panel open, through Edit › Move to Trash: the panel closes and Undo does not reopen it.
      await row(page, "Paint fence").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      await clickMenu(app, "trash");
      await expect(panel(page)).toBeHidden();
      await expect(row(page, "Paint fence")).toHaveCount(0);
      await expect(row(page, "Sand boards")).toHaveCount(0);
      await openView(page, "Trash");
      await expect(row(page, "Paint fence")).toHaveCount(1);
      await expect(page.locator("li.arow.sub .title")).toHaveText(["Sand boards"]);
      await expect(row(page, "Buy paint")).toHaveCount(1);
      await expect(row(page, "Buy paint")).not.toHaveClass(/\bsub\b/);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await openView(page, "Archive");
      await expect(row(page, "Paint fence")).toHaveCount(1);
      await expect(panel(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test("(k) T088 a reminder by right-click lands in the Trash's Reminders, Undo brings it back; Undo of a restore from the Trash sends it back", async () => {
    const { app, page } = await launchVesta({ dataDir: seed() });
    try {
      await openView(page, "Archive");
      await row(page, "Call mom").click({ button: "right" });
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await expect(toast(page)).toContainText("“Call mom” moved to the Trash.");
      await openView(page, "Trash");
      const reminders = page.locator("section[aria-labelledby='trash-rem-h']");
      await expect(reminders.locator("li.arow .title")).toHaveText(["Call mom"]);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(reminders.locator("li.arow")).toHaveCount(0);
      await openView(page, "Archive");
      await expect(row(page, "Call mom")).toHaveCount(1);
      // A restore from the Trash back to the Archive, then its Undo.
      await row(page, "Paint fence").locator("[data-ctl='delete']").click();
      await openView(page, "Trash");
      await row(page, "Paint fence").getByRole("button", { name: /^Restore/ }).click();
      await expect(row(page, "Paint fence")).toHaveCount(0);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(row(page, "Paint fence")).toHaveCount(1);
      await expect(page.locator("li.arow.sub .title")).toHaveText(["Buy paint", "Sand boards"]);
      await expect(row(page, "Paint fence").locator(".days")).toHaveText("30 days left");
    } finally {
      await app.close();
    }
  });

  test("(h) a failed save shows Changes are not saved and the entry stays; (i) a delete dismisses a Redo notification", async () => {
    const { app, page } = await launchVesta({ dataDir: seed() });
    try {
      // (i) a reschedule (Edit › Reschedule on the selected task), its Undo, then the Redo notification shows while an
      // Archive delete happens.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await page.keyboard.press("ArrowDown");
      await waitMenuState(app, "reschedule", { enabled: true });
      await clickMenu(app, "reschedule");
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(toast(page).getByRole("button", { name: "Redo" })).toBeVisible();
      await openView(page, "Archive");
      await row(page, "Call mom").locator("[data-ctl='delete']").click();
      await expect(toast(page).getByRole("button", { name: "Redo" })).toHaveCount(0);
      await expect(toast(page)).toContainText("“Call mom” moved to the Trash.");
      // (h)
      await setFault(app, "save");
      await row(page, "Paint fence").locator("[data-ctl='delete']").click();
      await expect(toast(page)).toContainText("Changes are not saved");
      await expect(row(page, "Paint fence")).toHaveCount(1);
      await setFault(app, "");
    } finally {
      await app.close();
    }
  });
});

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";

const card = (page: Page, title: string) =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const titles = (page: Page) => page.locator("li[data-kind='task'] .title");
const toast = (page: Page) => page.getByTestId("notification");

/** Cmd/Ctrl+Z goes through the Edit menu's Undo item (research.md §9); Playwright keys never reach native menus. */
async function pressUndoShortcut(app: ElectronApplication) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById("undo");
    item?.click(undefined, BrowserWindow.getAllWindows()[0]);
  });
}

async function setup() {
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Prepare report", position: 2 });
  seedTasks(dataDir, [
    task({ titleMd: "Renew passport", position: 1 }),
    parent,
    task({ titleMd: "Gather numbers", parentId: parent.id, position: 1 }),
    task({ titleMd: "Draft summary", parentId: parent.id, position: 2 }),
    task({ titleMd: "Fix bike", position: 3 }),
  ]);
  return launchVesta({ dataDir });
}

async function deleteViaMenu(page: Page, title: string) {
  await clickRevealed(card(page, title), card(page, title).getByRole("button", { name: "More actions" }));
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
}

test.describe("US4 — mark done and delete, with undo", () => {
  test("done: a parent takes its subtasks; the notification shows; (undo) puts all back in place (1, 3, 5)", async () => {
    const { app, page } = await setup();
    try {
      await card(page, "Prepare report").getByRole("checkbox", { name: "Mark done: Prepare report" }).click();
      await expect(titles(page)).toHaveText(["Renew passport", "Fix bike"]);
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(toast(page)).toHaveCount(0);
      await expect(titles(page)).toHaveText(["Renew passport", "Prepare report", "Gather numbers", "Draft summary", "Fix bike"]);
    } finally {
      await app.close();
    }
  });

  test("delete from the context menu; Cmd/Ctrl+Z undoes; a subtask alone leaves its parent (2, 4, 6)", async () => {
    const { app, page } = await setup();
    try {
      await deleteViaMenu(page, "Fix bike");
      await expect(toast(page)).toContainText(/moved to the Trash\./);
      await pressUndoShortcut(app);
      await expect(titles(page)).toHaveText(["Renew passport", "Prepare report", "Gather numbers", "Draft summary", "Fix bike"]);

      await card(page, "Gather numbers").getByRole("checkbox").click();
      await card(page, "Draft summary").getByRole("checkbox").click();
      await expect(titles(page)).toHaveText(["Renew passport", "Prepare report", "Fix bike"]);
      await expect(card(page, "Prepare report").getByRole("button", { name: /Collapse|Expand/ })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("Cmd/Ctrl+Z inside a title editor undoes typing, not the done (6)", async () => {
    const { app, page } = await setup();
    try {
      await card(page, "Fix bike").getByRole("checkbox").click();
      await page.getByRole("button", { name: "New task…" }).click();
      const editor = page.getByRole("textbox", { name: "New task…" });
      await editor.pressSequentially("abc");
      await expect(editor).toHaveText("abc");
      await pressUndoShortcut(app);
      await expect(editor).not.toHaveText("abc"); // the typing is undone…
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await expect(card(page, "Fix bike")).toHaveCount(0); // …and the done is not
    } finally {
      await app.close();
    }
  });

  test("disappears after 10 s even while hovered; then undo does nothing (7)", async () => {
    test.setTimeout(40_000);
    const { app, page } = await setup();
    try {
      await card(page, "Fix bike").getByRole("checkbox").click();
      await toast(page).hover();
      await page.waitForTimeout(9_000);
      await expect(toast(page)).toBeVisible();
      await expect(toast(page)).toHaveCount(0, { timeout: 3_000 });
      await pressUndoShortcut(app);
      await page.waitForTimeout(300);
      await expect(card(page, "Fix bike")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("close button appears on hover and dismisses; a second action replaces the first (8, 9)", async () => {
    const { app, page } = await setup();
    try {
      await card(page, "Fix bike").getByRole("checkbox").click();
      const close = toast(page).getByRole("button", { name: "Close" });
      await page.mouse.move(0, 0);
      await expect(close).toHaveCSS("opacity", "0");
      await toast(page).hover();
      await expect(close).toHaveCSS("opacity", "1");
      await close.click();
      await expect(toast(page)).toHaveCount(0);

      await card(page, "Renew passport").getByRole("checkbox").click();
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await deleteViaMenu(page, "Prepare report");
      await expect(toast(page)).toContainText(/moved to the Trash\./);
      await toast(page).getByRole("button", { name: "Undo" }).click();
      await expect(titles(page)).toHaveText(["Prepare report", "Gather numbers", "Draft summary"]);
      await expect(card(page, "Renew passport")).toHaveCount(0); // only the latest action was undone
    } finally {
      await app.close();
    }
  });
});

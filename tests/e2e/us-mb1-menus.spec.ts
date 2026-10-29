// 013 US1 (spec scenarios 1–11; quickstart rows 1, 4, 9, 10): every command from the menu bar, enabled only where it
// applies. Native menus cannot be opened by Playwright, so the real items are clicked and read from main (T022).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, menuItem, menuTitles, waitMenuState } from "./fixtures/menu";
import { reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";
import { nextConfirm } from "./fixtures/files";
import { IS_MAC } from "./fixtures/settings";

const card = (page: Page, title: string) =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const toast = (page: Page) => page.getByTestId("notification");

async function launch() {
  const dataDir = freshDataDir();
  const now = Date.now();
  seedTasks(dataDir, [
    staleTask({ titleMd: "Renew passport", position: 1 }),
    task({ titleMd: "Fix bike", position: 2 }),
    task({ titleMd: "Old idea", position: 3, deletedAt: now - 1000 }),
    task({ titleMd: "Paid rent", position: 4, doneAt: now - 1000 }),
  ]);
  return { ...(await launchVesta({ dataDir })), dataDir };
}

/** Selects a main-view card with the keyboard focus (its done checkbox), as Up/Down would. */
async function select(page: Page, title: string) {
  await card(page, title).locator('[data-ctl="cb"]').focus();
}

async function selectEntry(page: Page) {
  await page.locator("li.arow[data-id]").first().focus();
}

async function recordExternal(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(() => {
    (globalThis as unknown as { __vestaTest: { recordExternal: () => void } }).__vestaTest.recordExternal();
  });
  return () => app.evaluate(() => (globalThis as unknown as { __vestaTest: { externalUrls: () => string[] } }).__vestaTest.externalUrls());
}

test.describe("013 US1 — do everything from the menu bar", () => {
  test("US1-1 US1-2 the menus in order on this platform (development builds add Develop before Window)", async () => {
    const { app } = await launch();
    try {
      expect(await menuTitles(app)).toEqual(
        IS_MAC
          ? ["Vesta", "File", "Edit", "Format", "View", "Develop", "Window", "Help"]
          : ["File", "Edit", "Format", "View", "Develop", "Window", "Help"],
      );
    } finally {
      await app.close();
    }
  });

  test("US1-3 US1-4 US1-5 Mark as Done on the selected task; Edit items disabled with nothing selected; Reschedule on any active task (015 Q203)", async () => {
    const { app, page } = await launch();
    try {
      for (const id of ["done", "reschedule", "alertPeriod", "trash", "restore", "deleteForever"]) await waitMenuState(app, id, { enabled: false });
      await select(page, "Fix bike");
      await waitMenuState(app, "done", { enabled: true });
      await waitMenuState(app, "reschedule", { enabled: true });
      await select(page, "Renew passport");
      await waitMenuState(app, "reschedule", { enabled: true });
      await select(page, "Fix bike");
      await waitMenuState(app, "done", { enabled: true });
      await clickMenu(app, "done");
      await expect(toast(page)).toContainText("“Fix bike” moved to the Archive.");
      await expect(card(page, "Fix bike")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("US1-6 the Trash and the Archive enable Restore and Delete Permanently…; FR-018 the dialog confirms", async () => {
    const { app, page } = await launch();
    try {
      await clickMenu(app, "view:trash");
      await waitMenuState(app, "view:trash", { checked: true });
      await selectEntry(page);
      await waitMenuState(app, "deleteForever", { enabled: true });
      expect((await menuItem(app, "restore")).enabled).toBe(true);
      for (const id of ["done", "reschedule", "alertPeriod", "trash"]) expect((await menuItem(app, id)).enabled, id).toBe(false);
      await nextConfirm(app, false);
      await clickMenu(app, "deleteForever");
      await page.waitForTimeout(400);
      await expect(page.locator("li.arow[data-id]")).toHaveCount(1);
      await nextConfirm(app, true);
      await selectEntry(page);
      await clickMenu(app, "deleteForever");
      await expect(page.locator("li.arow[data-id]")).toHaveCount(0);
      await clickMenu(app, "view:archive");
      await selectEntry(page);
      await waitMenuState(app, "restore", { enabled: true });
      expect((await menuItem(app, "deleteForever")).enabled).toBe(false);
      // 018 FR-009: Move to Trash acts on a selected Archive entry.
      expect((await menuItem(app, "trash")).enabled).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("US1-7 US1-8 US1-9 View: the views are checked; Show Reminders and Show Details toggle", async () => {
    const { app, page } = await launch();
    try {
      await waitMenuState(app, "view:tasks", { checked: true });
      await clickMenu(app, "view:archive");
      await expect(page.locator("#view-h")).toBeVisible();
      await waitMenuState(app, "view:archive", { checked: true });
      await clickMenu(app, "view:tasks");
      await waitMenuState(app, "showReminders", { checked: true });
      await clickMenu(app, "showReminders");
      await waitMenuState(app, "showReminders", { checked: false });
      await clickMenu(app, "showReminders");
      await waitMenuState(app, "showDetails", { enabled: false });
      await select(page, "Fix bike");
      await waitMenuState(app, "showDetails", { enabled: true });
      await clickMenu(app, "showDetails");
      await expect(page.locator(".details-panel, [data-testid='details-panel']").first()).toBeVisible();
      await page.locator("body").focus();
      await waitMenuState(app, "showDetails", { checked: true });
      await clickMenu(app, "showDetails");
      await expect(page.locator(".details-panel, [data-testid='details-panel']")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("FR-015 PRD Q182 with no keyboard selection the menu acts on the item open in the panel; US1-9 Show Details is off on a reminder", async () => {
    const { app, page } = await launch();
    try {
      await card(page, "Fix bike").locator(".title").click();
      await expect(page.getByTestId("details-panel")).toBeVisible();
      await page.locator("body").focus();
      await waitMenuState(app, "done", { enabled: true });
      await clickMenu(app, "done");
      await expect(toast(page)).toContainText("“Fix bike” moved to the Archive.");
      await expect(card(page, "Fix bike")).toHaveCount(0);
    } finally {
      await app.close();
    }
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Fix bike", position: 1 })]);
    seedReminders(dataDir, [reminder({ textMd: "Water plants", position: 1 })]);
    const run = await launchVesta({ dataDir });
    try {
      await card(run.page, "Fix bike").locator(".title").click();
      await expect(run.page.getByTestId("details-panel")).toBeVisible();
      await run.page.locator("li[data-kind='rem'] [data-ctl='cb']").focus();
      await waitMenuState(run.app, "showDetails", { enabled: false, checked: true });
    } finally {
      await run.app.close();
    }
  });

  test("US1-10 US1-11 Help opens fixed URLs; Show Logs opens the log viewer", async () => {
    const { app, page } = await launch();
    try {
      const urls = await recordExternal(app);
      await clickMenu(app, "help");
      await clickMenu(app, "releaseNotes");
      await expect.poll(urls).toEqual([expect.stringMatching(/^https:\/\/github\.com\/[^/]+\/vesta#readme$/), expect.stringMatching(/\/releases\/tag\/v\d/)]);
      await clickMenu(app, "showLogs");
      await expect(page.locator("#logv-h")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("FR-020 macOS: with the window hidden, selection items are disabled and New Task brings the window back", async () => {
    test.skip(!IS_MAC, "the hidden window is macOS behavior (A1)");
    const { app, page } = await launch();
    try {
      await select(page, "Fix bike");
      await waitMenuState(app, "done", { enabled: true });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.hide();
      });
      await waitMenuState(app, "done", { enabled: false });
      const accel = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("newTask")?.accelerator ?? null);
      expect(accel).toBe("CmdOrCtrl+N");
      await clickMenu(app, "newTask");
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)).toBe(true);
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
    } finally {
      await app.close();
    }
  });
});

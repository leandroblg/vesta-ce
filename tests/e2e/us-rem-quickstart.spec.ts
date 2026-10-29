/**
 * The quickstart.md checks that no other spec automates (T068): the upgrade from a feature 001 data
 * folder, scenario 7 exactly as written, and scenario 15 done with the keyboard only. The other
 * scenarios map to the specs listed in quickstart.md's "Automated by" column.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminderCard, reminderList, reminderSection, reminderTexts, reminderToggle } from "./fixtures/reminders";
import { SCHEMA_VERSION, reminder, seedReminders, seedTasks, seedTasksAtVersion, task, writeLatestJson } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";
import { pressedView } from "./fixtures/nav";

const toast = (page: Page) => page.getByTestId("notification");
const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());
const latestJson = (dataDir: string) =>
  JSON.parse(readFileSync(join(dataDir, "backups", "latest.json"), "utf8")) as { writtenAt: number; schemaVersion: number };
const versionOf = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("select version from schema_version").get() as { version: number }).version;
  } finally {
    db.close();
  }
};

async function pressUndoShortcut(app: ElectronApplication) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.getMenuItemById("undo")?.click(undefined, BrowserWindow.getAllWindows()[0]);
  });
}

/** Presses Tab until `target` has focus: the keyboard is the only way the test moves around. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.describe("002 quickstart, automated (T068)", () => {
  test("upgrade check: a 001 data folder opens with its tasks, an empty expanded Reminders section, a version-1 pre-upgrade backup, then version-2 backups", async () => {
    const dataDir = freshDataDir();
    const rows = [task({ titleMd: "Renew passport", position: 1 }), task({ titleMd: "Fix bike", position: 2, collapsed: false })];
    seedTasksAtVersion(dataDir, rows, 1);
    let run = await launchVesta({ dataDir });
    expect(await taskTitles(run.page)).toEqual(["Renew passport", "Fix bike"]);
    await expect(reminderToggle(run.page)).toHaveAttribute("aria-expanded", "true");
    await expect(reminderSection(run.page).locator(".count")).toHaveText("0");
    await expect(reminderSection(run.page).getByRole("button", { name: "New reminder…" })).toBeVisible();
    expect(latestJson(dataDir).schemaVersion).toBe(1); // the pre-upgrade backup (001 FR-043)
    expect(versionOf(join(dataDir, "backups", "latest.sqlite"))).toBe(1);
    await run.app.close();

    const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
    try {
      expect((db.prepare("select version from schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
      const stored = db.prepare("select id, title_md as titleMd, position, created_at as createdAt, updated_at as updatedAt from tasks order by position").all();
      expect(stored).toEqual(rows.map(({ id, titleMd, position, createdAt, updatedAt }) => ({ id, titleMd, position, createdAt, updatedAt })));
    } finally {
      db.close();
    }

    // The next automatic backup (due 30 min after the last one) is written at the current version.
    writeLatestJson(dataDir, Date.now() - 31 * 60_000, 1);
    run = await relaunch(run);
    try {
      await expect.poll(() => existsSync(join(dataDir, "backups", "latest.json")) && latestJson(dataDir).schemaVersion, { timeout: 15_000 }).toBe(SCHEMA_VERSION);
      expect(versionOf(join(dataDir, "backups", "latest.sqlite"))).toBe(SCHEMA_VERSION);
    } finally {
      await run.app.close();
    }
  });

  test("scenario 7: delete a reminder, then mark a task done; Cmd/Ctrl+Z undoes only the task", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Fix bike" })]);
    seedReminders(dataDir, [reminder({ textMd: "Call the bank" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await clickRevealed(reminderCard(page, "Call the bank"), reminderCard(page, "Call the bank").getByRole("button", { name: "Move to Trash" }));
      await expect(toast(page)).toContainText(/moved to the Trash\./);
      await page.locator("li[data-kind='task']").getByRole("checkbox", { name: "Mark done: Fix bike" }).click();
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await pressUndoShortcut(app);
      await expect.poll(() => taskTitles(page)).toEqual(["Fix bike"]);
      expect(await reminderTexts(page)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("scenario 15: toggle, add, edit, tick, delete and restore with the keyboard only; every control is named", async () => {
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    let run = await launchVesta();
    const { page } = run;

    // Toggle: Enter collapses, Space expands; the state is announced.
    await tabTo(page, reminderToggle(page));
    await expect(reminderToggle(page)).toHaveAccessibleName(/^Reminders/);
    await page.keyboard.press("Enter");
    await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "true");

    // Add two reminders through the empty card.
    await tabTo(page, reminderSection(page).getByRole("button", { name: "New reminder…" }));
    await page.keyboard.press("Enter");
    await page.keyboard.type("Alpha");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Beta");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    expect(await reminderTexts(page)).toEqual(["Alpha", "Beta"]);

    // Edit through the Edit button.
    const edit = reminderCard(page, "Alpha").getByRole("button", { name: "Edit" });
    await tabTo(page, edit);
    await page.keyboard.press("Enter");
    await expect(page.locator("li[data-kind='rem'] [role='textbox']")).toBeFocused();
    await page.keyboard.press(selectAll);
    await page.keyboard.type("Alpha edited");
    await page.keyboard.press("Enter");
    await expect.poll(() => reminderTexts(page)).toEqual(["Alpha edited", "Beta"]);

    // Tick with Space, delete with Enter on "Move to Trash".
    const tick = reminderCard(page, "Beta").getByRole("checkbox", { name: "Mark done: Beta" });
    await tabTo(page, tick);
    await page.keyboard.press("Space");
    await expect.poll(() => reminderTexts(page)).toEqual(["Alpha edited"]);
    const del = reminderCard(page, "Alpha edited").getByRole("button", { name: "Move to Trash" });
    await tabTo(page, del);
    await page.keyboard.press("Enter");
    await expect.poll(() => reminderTexts(page)).toEqual([]);

    // Restore from the Archive and the Trash.
    for (const [view, text] of [["Archive", "Beta"], ["Trash", "Alpha edited"]] as const) {
      await tabTo(page, page.getByRole("button", { name: new RegExp(`^${view}`) }));
      await page.keyboard.press("Enter");
      await tabTo(page, page.getByRole("button", { name: `Restore: ${text}` }));
      await page.keyboard.press("Enter");
      await tabTo(page, pressedView(page));
      await page.keyboard.press("Enter");
    }
    expect((await reminderTexts(page)).sort()).toEqual(["Alpha edited", "Beta"]);
    await expect(reminderList(page)).toBeVisible();

    run = await relaunch(run);
    try {
      expect((await reminderTexts(run.page)).sort()).toEqual(["Alpha edited", "Beta"]);
    } finally {
      await run.app.close();
    }
  });
});

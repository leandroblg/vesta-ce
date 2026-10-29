import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminderCard, reminderSection, reminderTexts, newReminderEditor } from "./fixtures/reminders";
import { DAY, reminder, seedReminders } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";

const toast = (page: Page) => page.getByTestId("notification");
const entry = (page: Page, text: string) =>
  page.locator("section[aria-labelledby$='-rem-h'] .arow").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });

/** Faults are read at each save in the main process, so they can be switched on mid-run (development builds only). */
const setFault = (app: ElectronApplication, value: string) =>
  app.evaluate((_electron, v) => {
    process.env["VESTA_FAULT"] = v;
  }, value);

async function expectNotSaved(page: Page) {
  await expect(toast(page)).toContainText("Changes are not saved");
  await clickRevealed(toast(page), toast(page).getByRole("button", { name: "Close" }));
  await expect(toast(page)).toHaveCount(0);
}

test("002 FR-022: every failed reminder save shows 'Changes are not saved', keeps the last saved state and is logged", async () => {
  test.setTimeout(60_000);
  const dataDir = freshDataDir();
  const now = Date.now();
  const a = reminder({ textMd: "A", position: 1 });
  const b = reminder({ textMd: "B", position: 2 });
  const done = reminder({ textMd: "Done one", doneAt: now - DAY });
  const deleted = reminder({ textMd: "Deleted one", deletedAt: now - DAY });
  seedReminders(dataDir, [a, b, done, deleted]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    // An action that succeeds before the fault, so its undo can fail later.
    await reminderCard(page, "B").getByRole("checkbox").click();
    await expect(toast(page)).toContainText(/moved to the Archive\./);
    await setFault(app, "save");
    await toast(page).getByRole("button", { name: "Undo" }).click();
    await expectNotSaved(page);
    expect(await reminderTexts(page)).toEqual(["A"]); // the failed undo left it in the Archive

    await reminderSection(page).getByRole("button", { name: "New reminder…" }).click();
    await newReminderEditor(page).fill("Never saved");
    await newReminderEditor(page).press("Enter");
    await expectNotSaved(page); // closing the notice moves focus out, which closes the empty card
    expect(await reminderTexts(page)).toEqual(["A"]);

    await reminderCard(page, "A").locator(".title").dblclick();
    await page.locator("li[data-kind='rem'] [role='textbox']").fill("A edited");
    await page.locator("li[data-kind='rem'] [role='textbox']").press("Enter");
    await expectNotSaved(page);
    expect(await reminderTexts(page)).toEqual(["A"]);

    await reminderCard(page, "A").getByRole("checkbox").click();
    await expectNotSaved(page);
    expect(await reminderTexts(page)).toEqual(["A"]);

    await clickRevealed(reminderCard(page, "A"), reminderCard(page, "A").getByRole("button", { name: "Move to Trash" }));
    await expectNotSaved(page);
    expect(await reminderTexts(page)).toEqual(["A"]);

    await page.getByRole("button", { name: /^Archive/ }).click();
    await entry(page, "Done one").getByRole("button", { name: "Restore: Done one" }).click();
    await expectNotSaved(page);
    await expect(entry(page, "Done one")).toBeVisible();

    await page.getByRole("button", { name: /^Trash/ }).click();
    await entry(page, "Deleted one").getByRole("button", { name: "Delete permanently: Deleted one" }).click();
    await entry(page, "Deleted one").getByRole("button", { name: "Click again to delete: Deleted one" }).click();
    await expectNotSaved(page);
    await expect(entry(page, "Deleted one")).toBeVisible();

    const log = join(dataDir, "logs", "vesta-001.log");
    await expect.poll(() => existsSync(log)).toBe(true);
    const failures = readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.includes('"save.failed"'))
      .map((l) => JSON.parse(l) as { action: string; ids: string[] });
    const byAction = (action: string) => failures.find((f) => f.action === action);
    expect(byAction("undo:apply")).toBeDefined();
    expect(byAction("reminders:create")).toBeDefined();
    expect(byAction("reminders:edit-text")?.ids).toEqual([a.id]);
    expect(byAction("reminders:mark-done")?.ids).toEqual([a.id]);
    expect(byAction("reminders:delete")?.ids).toEqual([a.id]);
    expect(byAction("reminders:restore")?.ids).toEqual([done.id]);
    expect(byAction("reminders:delete-permanently")?.ids).toEqual([deleted.id]);
  } finally {
    await app.close();
  }
});

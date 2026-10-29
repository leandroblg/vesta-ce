/** 008 helpers: export and import through the UI, zip contents and snapshots (quickstart "Test controls"). */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { readSnapshot, type DataSnapshot } from "../../unit/fixtures/export-compare";
import { readZip } from "../../unit/fixtures/zip";
import type { Reminder } from "../../../src/domain/reminder";
import type { Task } from "../../../src/domain/task";
import { PDF, PNG, ROWS } from "./md-corpus";
import { DAY, addTasks, reminder, seedAsset, seedReminders, seedSetting, staleTask, task } from "./seed";
import { dialog, openSettings, showPane } from "./settings";

export const section = (page: Page) => dialog(page).locator(".data-section");
export const status = (page: Page) => page.getByTestId("data-status");
export const notice = (page: Page) => page.getByTestId("notification");

/** A new empty folder to export into. */
export function exportFolder(): string {
  return mkdtempSync(join(tmpdir(), "vesta-export-"));
}

/** The next folder or file picker answers `path` (null = Cancel). */
export async function nextDialog(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate((_e, p) => {
    (globalThis as unknown as { __vestaTest: { setNextDialogPath: (x: string | null) => void } }).__vestaTest.setNextDialogPath(p);
  }, path);
}

async function ensureSettings(page: Page): Promise<void> {
  if (!(await page.locator("dialog.settings-dialog[open]").isVisible())) await openSettings(page);
  await showPane(page, "Data");
}

/** Export into `folder` through Settings; waits until the section is idle again and returns the status text. */
export async function exportVia(app: ElectronApplication, page: Page, folder: string | null, options: { includeLogs?: boolean } = {}): Promise<string> {
  await ensureSettings(page);
  await nextDialog(app, folder);
  const box = page.getByTestId("include-logs");
  if ((options.includeLogs ?? false) !== (await box.isChecked())) await box.click();
  await page.getByTestId("export").click();
  await expect(page.getByTestId("export")).toBeEnabled({ timeout: 60_000 });
  return (await status(page).textContent()) ?? "";
}

/**
 * Import `zip` through Settings; waits until the import ended. A merge closes Settings and shows the notice;
 * every other outcome leaves Settings open with its status.
 */
export async function importVia(app: ElectronApplication, page: Page, zip: string | null): Promise<"merged" | "kept"> {
  await ensureSettings(page);
  await nextDialog(app, zip);
  await page.getByTestId("import").click();
  const merged = notice(page).and(page.locator("[data-kind='importUndo']"));
  await expect(merged.or(page.getByTestId("import").and(page.locator(":enabled")))).toBeVisible({ timeout: 60_000 });
  return (await merged.isVisible()) ? "merged" : "kept";
}

export async function zipEntries(zip: string): Promise<string[]> {
  return [...(await readZip(zip)).keys()].sort();
}

/** The data folder's snapshot, read-only while the app runs (research §12). */
export function snapshotOf(dataDir: string): DataSnapshot {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return readSnapshot(db, dataDir);
  } finally {
    db.close();
  }
}

export async function setFault(app: ElectronApplication, value: string): Promise<void> {
  await app.evaluate((_e, v) => {
    process.env["VESTA_FAULT"] = v;
  }, value);
}

/**
 * The SC-001 source profile (quickstart "Test controls"): every item state, the 005 round-trip corpus, a file
 * referenced twice and one referenced by an active and a Trash item, a linked PDF, every exported setting
 * changed, and more than 200 active reminders.
 */
export function seedFullProfile(dataDir: string): { taskCount: number; reminderCount: number } {
  const now = Date.now();
  const image = seedAsset(dataDir, PNG, "png", "image/png");
  const pdf = seedAsset(dataDir, PDF, "pdf", "application/pdf");
  const refs = { image, file: pdf };
  const tasks: Task[] = [];
  ROWS.forEach((row, i) => {
    const md = row.stored(refs);
    tasks.push(
      task({
        titleMd: row.scopes.includes("title") ? md : `Corpus ${String(i)}`,
        detailsMd: row.scopes.includes("details") ? md : "",
        position: i + 1,
      }),
    );
  });
  const parent = task({ titleMd: "**Parent** collapsed", collapsed: true, position: 100, detailsMd: `![twice](${image}) and again ![twice](${image})` });
  tasks.push(parent);
  tasks.push(task({ titleMd: "Active subtask", parentId: parent.id, position: 1 }));
  tasks.push(task({ titleMd: "Done subtask", parentId: parent.id, position: 2, doneAt: now - DAY }));
  tasks.push(task({ titleMd: "Archived, was stale", doneAt: now - 2 * DAY, wasStale: true, position: 101 }));
  const trashParent = task({ titleMd: "Trashed parent", deletedAt: now - 5 * DAY, position: 102, detailsMd: `![t](${image})` });
  tasks.push(trashParent);
  tasks.push(task({ titleMd: "Went with it", parentId: trashParent.id, deletedAt: now - 5 * DAY, leftWithId: trashParent.id, position: 1 }));
  tasks.push(staleTask({ titleMd: "Stale one", position: 103 }));
  tasks.push(task({ titleMd: "Overridden", alertOverrideMin: 120, position: 104 }));
  tasks.push(task({ titleMd: "Rescheduled", createdAt: now - 3 * DAY, staleBaseAt: now - DAY / 2, wasStale: true, position: 105, manuallyPositioned: true }));
  addTasks(dataDir, tasks);
  const reminders: Reminder[] = [];
  for (let i = 0; i < 205; i++) reminders.push(reminder({ textMd: i === 0 ? "**Bold** reminder" : `Reminder ${String(i)}`, position: i + 1 }));
  reminders.push(reminder({ textMd: "Done reminder", doneAt: now - DAY, position: 300 }));
  reminders.push(reminder({ textMd: "Deleted reminder", deletedAt: now - DAY, position: 301 }));
  seedReminders(dataDir, reminders);
  seedSetting(dataDir, "alertPeriodMin", 120);
  seedSetting(dataDir, "reblinkIntervalMin", 60);
  seedSetting(dataDir, "rescheduleToleranceMin", 180);
  seedSetting(dataDir, "theme", "dark");
  seedSetting(dataDir, "language", "it");
  seedSetting(dataDir, "shortcuts", { newTask: ["Mod+Alt+N"] });
  seedSetting(dataDir, "panelWidth", 500);
  seedSetting(dataDir, "remindersCollapsed", true);
  return { taskCount: tasks.length, reminderCount: reminders.length };
}

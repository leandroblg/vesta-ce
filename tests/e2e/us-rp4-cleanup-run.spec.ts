// 018 US4 (AC4–AC7; FR-017 to FR-019, FR-017a; SC-004; PRD Q273, Q278, Q283): the two cleanups at start and on a run,
// each on its own place and time, with their groups and orphaned files, logged once with the counts. The gate that holds
// a run during an export or an import is covered by tests/unit/main/purge-scheduler.test.ts ("runNow ... waiting for an
// export to end"), and end to end by (c).
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { HOUR, advanceClock } from "./fixtures/clock";
import { exportFolder, nextDialog, setFault } from "./fixtures/export";
import { nextConfirm } from "./fixtures/files";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { entriesFor } from "./fixtures/logs";
import { runPurge } from "./fixtures/purge";
import { DAY, addTasks, seedAsset, seedSettings, seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";

const YEAR = 365 * DAY;
const NOW = Date.now();

function titles(dataDir: string): string[] {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    return (db.prepare("select title_md as t from tasks order by t").all() as { t: string }[]).map((r) => r.t);
  } finally {
    db.close();
  }
}
const openView = (page: Page, view: "Archive" | "Trash") => page.getByRole("button", { name: new RegExp(`^${view}`) }).click();

test("(a) a launch removes an Archive group past 10 years with its orphaned file, and a Trash item past 30 days; logged once", async () => {
  const dataDir = freshDataDir();
  const ref = seedAsset(dataDir, new TextEncoder().encode("only the old item uses this"), "txt");
  const old = task({ titleMd: "Ancient", doneAt: NOW - 11 * YEAR, updatedAt: NOW - 11 * YEAR, detailsMd: `[file](${ref})` });
  const sub = task({ titleMd: "Ancient sub", parentId: old.id, doneAt: NOW - 11 * YEAR, updatedAt: NOW - 11 * YEAR, leftWithId: old.id });
  addTasks(dataDir, [old, sub, task({ titleMd: "Gone long ago", deletedAt: NOW - 31 * DAY }), task({ titleMd: "Recent done", doneAt: NOW - DAY, updatedAt: NOW - DAY }), task({ titleMd: "Active" })]);
  const { app } = await launchVesta({ dataDir });
  try {
    await expect.poll(() => titles(dataDir)).toEqual(["Active", "Recent done"]);
    expect(existsSync(join(dataDir, ref))).toBe(false);
    await expect
      .poll(() => entriesFor(dataDir, "purge.removed").map((e) => ({ count: e["count"], archive: e["archive"], trash: e["trash"] })))
      .toEqual([{ count: 3, archive: 2, trash: 1 }]);
  } finally {
    await app.close();
  }
});

test("(b) (d) (e) (f) each cleanup on its own place and time; both off remove nothing; the notes name the times", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [
    task({ titleMd: "Deleted six days ago", deletedAt: NOW - 6 * DAY }),
    task({ titleMd: "Deleted 3.5 days ago", deletedAt: NOW - 3.5 * DAY }),
    task({ titleMd: "Done long ago", doneAt: NOW - 100 * DAY, updatedAt: NOW - 100 * DAY }),
  ]);
  seedSettings(dataDir, { trashCleanupHours: "120" });
  const { app, page } = await launchVesta({ dataDir });
  try {
    await runPurge(app);
    await expect.poll(() => titles(dataDir)).toEqual(["Deleted 3.5 days ago", "Done long ago"]);
    await openView(page, "Trash");
    await expect(page.locator(".view-head")).toContainText("5 days after deletion");
    await expect(page.locator("li.arow .days")).toHaveText("2 days left");
    await openView(page, "Archive");
    await expect(page.locator(".view-head")).toContainText("after 10 years");
  } finally {
    await app.close();
  }
  const off = freshDataDir();
  seedTasks(off, [task({ titleMd: "Old gone", deletedAt: NOW - 40 * DAY }), task({ titleMd: "Old done", doneAt: NOW - 11 * YEAR, updatedAt: NOW - 11 * YEAR })]);
  seedSettings(off, { trashCleanupOn: "false", archiveCleanupOn: "false" });
  const second = await launchVesta({ dataDir: off });
  try {
    await runPurge(second.app);
    expect(titles(off)).toEqual(["Old done", "Old gone"]);
  } finally {
    await second.app.close();
  }
});

test("(g) Q283 a restore back to the Archive past its time waits out the Undo window, so Undo still finds it", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Kept done", deletedAt: NOW - DAY, keptDoneAt: NOW - 11 * YEAR })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await openView(page, "Trash");
    await page.locator("li.arow").getByRole("button", { name: /^Restore/ }).click();
    await runPurge(app);
    expect(titles(dataDir)).toEqual(["Kept done"]);
    await page.getByTestId("notification").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("li.arow")).toHaveCount(1);
    await page.locator("li.arow").getByRole("button", { name: /^Restore/ }).click();
    await advanceClock(app, 12_000);
    await runPurge(app);
    await expect.poll(() => titles(dataDir)).toEqual([]);
  } finally {
    await app.close();
  }
});

test("(b2) T080 FR-020b: a confirmed shorter Archive time removes nothing for its hour, across a restart; the Trash is not held back", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [
    task({ titleMd: "Done A", doneAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR }),
    task({ titleMd: "Done B", doneAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR }),
    task({ titleMd: "Gone", deletedAt: NOW - 40 * DAY }),
  ]);
  let launched = await launchVesta({ dataDir });
  try {
    // The start run removes the Trash row; the Archive rows are inside its 10 years.
    await expect.poll(() => titles(dataDir)).toEqual(["Done A", "Done B"]);
    const { app, page } = launched;
    await openSettings(page, "Data");
    await nextConfirm(app, true);
    const field = (name: "Years" | "Hours") => dialog(page).getByTestId("cleanup-archive").getByLabel(name, { exact: true });
    await field("Years").fill("0");
    await field("Hours").fill("1");
    await page.keyboard.press("Enter");
    await expect(dialog(page).getByTestId("cleanup-archive-countdown")).toBeVisible();
    await closeSettings(page);
    addTasks(dataDir, [task({ titleMd: "Gone too", deletedAt: NOW - 40 * DAY })]);
    await runPurge(app);
    expect(titles(dataDir)).toEqual(["Done A", "Done B"]);
    // A restart: the start run still holds the Archive back.
    launched = await relaunch(launched);
    await runPurge(launched.app);
    expect(titles(dataDir)).toEqual(["Done A", "Done B"]);
    // After the hour, the new time applies.
    await advanceClock(launched.app, HOUR);
    await runPurge(launched.app);
    await expect.poll(() => titles(dataDir)).toEqual([]);
  } finally {
    await launched.app.close();
  }
});

test("(c) T085 a run during an export removes nothing until the export ends", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Kept" })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await runPurge(app);
    addTasks(dataDir, [task({ titleMd: "Gone long ago", deletedAt: NOW - 40 * DAY })]);
    await setFault(app, "slow-export");
    await openSettings(page, "Data");
    await nextDialog(app, exportFolder());
    await page.getByTestId("export").click();
    await expect(page.getByTestId("import")).toBeDisabled();
    const run = runPurge(app);
    await page.waitForTimeout(500);
    expect(titles(dataDir)).toEqual(["Gone long ago", "Kept"]);
    await expect(page.getByTestId("import")).toBeEnabled({ timeout: 5_000 });
    await run;
    await expect.poll(() => titles(dataDir)).toEqual(["Kept"]);
  } finally {
    await setFault(app, "");
    await app.close();
  }
});

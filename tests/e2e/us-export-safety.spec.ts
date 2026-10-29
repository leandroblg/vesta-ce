// 008 safety: failures restore, Undo import, the offer's end and the backup swap, crash and quit, and Settings
// held open while importing (US4-6, US4-7, US3-9, US3-10, US3-12; quickstart 8–12, 18; FR-003, FR-036a,
// FR-037 to FR-037c; SC-009, SC-010; analysis U4; tasks T057).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { snapshotDiff } from "../unit/fixtures/export-compare";
import { writeDamaged } from "../unit/fixtures/damage";
import { taskCard } from "./fixtures/alerts";
import { advanceClock } from "./fixtures/clock";
import { dragTo } from "./fixtures/drag";
import { exportFolder, importVia, nextDialog, notice, setFault, snapshotOf, status } from "./fixtures/export";
import { freshDataDir, launchVesta, relaunch, type Launched } from "./fixtures/launch";
import { addTasks, task } from "./fixtures/seed";
import { MOD, dialog, openSettings, setTheme } from "./fixtures/settings";

/** A data folder with a few items and its first automatic backup written. */
async function launchWithData(): Promise<Launched> {
  const dataDir = freshDataDir();
  addTasks(dataDir, [task({ titleMd: "Mine" }), task({ titleMd: "Second", position: 2 })]);
  const launched = await launchVesta({ dataDir });
  await expect(taskCard(launched.page, "Mine")).toBeVisible();
  await expect.poll(() => existsSync(join(dataDir, "backups", "latest.json"))).toBe(true);
  return launched;
}

function validZip(): string {
  const zip = join(exportFolder(), "valid.zip");
  writeDamaged(zip, "valid");
  return zip;
}

/** The backup databases and their info files (SQLite side files left by integrity checks are not backups). */
const backups = (dataDir: string) =>
  readdirSync(join(dataDir, "backups"))
    .filter((n) => /\.(?:sqlite|json)$/.test(n))
    .sort();
const latestJson = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, "backups", "latest.json"), "utf8")) as { writtenAt: number };
const offerState = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __vestaTest: { undoOfferState: () => unknown } }).__vestaTest.undoOfferState());

/** The offer ended in main: no offer, the pre-import backup promoted to latest, one backup left. */
async function expectPromoted(app: ElectronApplication, dataDir: string, preWrittenAt: number): Promise<void> {
  await expect.poll(() => offerState(app)).toBeNull();
  expect(backups(dataDir)).toEqual(["latest.json", "latest.sqlite"]);
  expect(latestJson(dataDir).writtenAt).toBe(preWrittenAt);
}

async function importValid(app: ElectronApplication, page: Page, dataDir: string): Promise<number> {
  expect(await importVia(app, page, validZip())).toBe("merged");
  await expect(dialog(page)).toBeHidden(); // Settings closed by itself (PRD Q121)
  await expect(notice(page)).toHaveAttribute("data-kind", "importUndo");
  return (JSON.parse(readFileSync(join(dataDir, "backups", "pre-import.json"), "utf8")) as { writtenAt: number }).writtenAt;
}

test.describe("008 — import safety", () => {
  test("a write that fails restores the pre-import backup: data identical, the message, Settings open (US4-6, SC-009)", async () => {
    const { app, page, dataDir } = await launchWithData();
    try {
      const before = snapshotOf(dataDir);
      await setFault(app, "import-write");
      expect(await importVia(app, page, validZip())).toBe("kept");
      await expect(status(page)).toHaveText("The import could not be completed. Your data was restored to how it was before the import.");
      expect(snapshotDiff(before, snapshotOf(dataDir))).toEqual([]);
      expect(backups(dataDir)).toEqual(["latest.json", "latest.sqlite"]);
    } finally {
      await app.close();
    }
  });

  test("a pre-import backup that cannot be written: did not start, nothing written, latest kept (US4-7)", async () => {
    const { app, page, dataDir } = await launchWithData();
    try {
      const before = snapshotOf(dataDir);
      const latest = readFileSync(join(dataDir, "backups", "latest.json"), "utf8");
      await setFault(app, "pre-import-backup");
      expect(await importVia(app, page, validZip())).toBe("kept");
      await expect(status(page)).toHaveText("The import did not start: Vesta could not back up your data first.");
      expect(snapshotDiff(before, snapshotOf(dataDir))).toEqual([]);
      expect(readFileSync(join(dataDir, "backups", "latest.json"), "utf8")).toBe(latest);
      expect(backups(dataDir)).toEqual(["latest.json", "latest.sqlite"]);
    } finally {
      await app.close();
    }
  });

  test("data found damaged by the pre-import check: did not start, and the restart notice (FR-036a)", async () => {
    const { app, page, dataDir } = await launchWithData();
    try {
      const before = snapshotOf(dataDir);
      await setFault(app, "damaged");
      expect(await importVia(app, page, validZip())).toBe("kept");
      await expect(status(page)).toHaveText("The import did not start: Vesta could not back up your data first.");
      await expect(notice(page)).toHaveAttribute("data-kind", "dataDamaged");
      expect(snapshotDiff(before, snapshotOf(dataDir))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("Undo import within 60 s puts everything back, theme included (US3-9, SC-010)", async () => {
    const { app, page, dataDir } = await launchWithData();
    try {
      const before = snapshotOf(dataDir);
      await importValid(app, page, dataDir);
      await expect(taskCard(page, "From the export")).toBeVisible();
      expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
      await page.getByTestId("undo-import").click();
      await expect(notice(page)).toContainText("Import undone. Your data is back to how it was before the import.");
      await expect(taskCard(page, "From the export")).toHaveCount(0);
      expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("system");
      expect(snapshotDiff(before, snapshotOf(dataDir), { ignoreFilesOnlyIn: "b" })).toEqual([]);
      await expect.poll(() => offerState(app)).toBeNull();
      expect(backups(dataDir)).toEqual(["latest.json", "latest.sqlite"]);
    } finally {
      await app.close();
    }
  });

  test("an undo that fails leaves the merged data intact (FR-037b)", async () => {
    const { app, page, dataDir } = await launchWithData();
    try {
      await importValid(app, page, dataDir);
      const merged = snapshotOf(dataDir);
      await setFault(app, "undo-restore");
      await page.getByTestId("undo-import").click();
      await expect(notice(page)).toContainText("The import could not be undone.");
      expect(snapshotDiff(merged, snapshotOf(dataDir))).toEqual([]);
      await expect(taskCard(page, "From the export")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("the offer ends after 60 s: the pre-import backup becomes the only backup; a late Undo does nothing (US3-10)", async () => {
    const { app, page, dataDir } = await launchWithData();
    try {
      const pre = await importValid(app, page, dataDir);
      expect(backups(dataDir)).toEqual(["latest.json", "latest.sqlite", "pre-import.json", "pre-import.sqlite"]);
      await advanceClock(app, 61_000);
      await expectPromoted(app, dataDir, pre);
      const merged = snapshotOf(dataDir);
      await page.getByTestId("undo-import").click();
      await expect(notice(page)).toHaveCount(0);
      expect(snapshotDiff(merged, snapshotOf(dataDir))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("the offer ends when the notice is closed, replaced by a done notice, or a setting changes (US3-10)", async () => {
    const closeIt = async (page: Page) => {
      await notice(page).hover();
      await notice(page).getByRole("button", { name: "Close" }).click();
    };
    const doneOther = async (page: Page) => {
      await taskCard(page, "Second").getByRole("checkbox").click();
      await expect(notice(page)).toHaveAttribute("data-kind", "done");
    };
    const themeChange = async (page: Page) => {
      await setTheme(page, "Light");
    };
    for (const end of [closeIt, doneOther, themeChange]) {
      const { app, page, dataDir } = await launchWithData();
      try {
        const pre = await importValid(app, page, dataDir);
        await end(page);
        await expectPromoted(app, dataDir, pre);
      } finally {
        await app.close();
      }
    }
  });

  test("starting an edit ends the offer and removes the notice at once (analysis U4)", async () => {
    const titleEdit = async (page: Page) => {
      await taskCard(page, "Mine").locator(".title").dblclick();
    };
    const detailsTyping = async (page: Page) => {
      await taskCard(page, "Mine").locator(".title").click();
      const details = page.getByRole("complementary", { name: "Details" }).getByRole("textbox", { name: "Details" });
      await details.click();
      await page.keyboard.type("typed after import");
    };
    const dragStart = async (page: Page) => {
      // Held, not released: the drag starting is what ends the offer.
      await dragTo(page, taskCard(page, "Second"), { row: taskCard(page, "Mine"), zone: "upper" }, { release: false });
    };
    for (const start of [titleEdit, detailsTyping, dragStart]) {
      const { app, page, dataDir } = await launchWithData();
      try {
        const pre = await importValid(app, page, dataDir);
        await start(page);
        await expect(notice(page).and(page.locator("[data-kind='importUndo']"))).toHaveCount(0);
        await expectPromoted(app, dataDir, pre);
      } finally {
        await app.close();
      }
    }
  });

  test("while an import runs, Settings cannot be closed and shows its progress (US3-12, FR-003)", async () => {
    const { app, page } = await launchWithData();
    try {
      await setFault(app, "slow-import");
      await openSettings(page, "Data");
      await nextDialog(app, validZip());
      await page.getByTestId("import").click();
      await expect(page.getByTestId("data-status")).toHaveText("Importing…");
      await expect(page.getByTestId("import")).toBeDisabled();
      await expect(page.getByTestId("export")).toBeDisabled();
      await page.keyboard.press("Escape");
      await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
      await page.keyboard.press(`${MOD}+Comma`);
      await page.mouse.click(5, 5);
      await expect(page.locator("dialog.settings-dialog[open]")).toBeVisible();
      await expect(page.getByTestId("data-status")).toHaveText("Importing…");
      await setFault(app, "");
      await expect(notice(page)).toHaveAttribute("data-kind", "importUndo", { timeout: 10_000 });
      await expect(dialog(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test("quitting during the offer promotes the backup; a crash during it is settled at the next start (FR-037a)", async () => {
    const quit = await launchWithData();
    const preQuit = await importValid(quit.app, quit.page, quit.dataDir);
    const again = await relaunch(quit);
    try {
      expect(backups(again.dataDir)).toEqual(["latest.json", "latest.sqlite"]);
      expect(latestJson(again.dataDir).writtenAt).toBe(preQuit);
    } finally {
      await again.app.close();
    }

    const crash = await launchWithData();
    const preCrash = await importValid(crash.app, crash.page, crash.dataDir);
    crash.app.process().kill("SIGKILL");
    const after = await launchVesta({ dataDir: crash.dataDir });
    try {
      await expect(taskCard(after.page, "From the export")).toBeVisible();
      expect(backups(crash.dataDir)).toEqual(["latest.json", "latest.sqlite"]);
      expect(latestJson(crash.dataDir).writtenAt).toBe(preCrash);
    } finally {
      await after.app.close();
    }
  });

  test("quitting while an import runs waits for it to end (edge case)", async () => {
    const { app, page, dataDir } = await launchWithData();
    await setFault(app, "slow-import");
    await openSettings(page, "Data");
    await nextDialog(app, validZip());
    await page.getByTestId("import").click();
    await expect(page.getByTestId("data-status")).toHaveText("Importing…");
    await app.close();
    const again = await launchVesta({ dataDir });
    try {
      await expect(taskCard(again.page, "From the export")).toBeVisible();
      expect(backups(dataDir)).toEqual(["latest.json", "latest.sqlite"]);
    } finally {
      await again.app.close();
    }
  });
});

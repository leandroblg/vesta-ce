// 008 US4: a damaged or foreign file is refused before anything changes (US4-1 to US4-5, US4-8; quickstart 5;
// FR-021 to FR-023; SC-003; tasks T056).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { snapshotDiff } from "../unit/fixtures/export-compare";
import { IMG_PATH, writeDamaged, type DamageVariant } from "../unit/fixtures/damage";
import { taskCard } from "./fixtures/alerts";
import { exportFolder, importVia, snapshotOf, status } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { addTasks, reminder, seedReminders, task } from "./fixtures/seed";

const REFUSED: [DamageVariant, string][] = [
  ["changedByte", `This export is damaged: a file does not match its checksum (${IMG_PATH}).`],
  ["missingFile", `This export is damaged: a listed file is missing (${IMG_PATH}).`],
  ["noDataJson", "This is not a Vesta export."],
  ["truncatedDataJson", "This is not a Vesta export."],
  ["newerVersion", "This export was made by a newer version of Vesta. Update Vesta, then import it again."],
  ["invalidField", "This export is damaged: an invalid value (tasks[0].collapsed)."],
  ["unrelatedZip", "This is not a Vesta export."],
  ["notAZip", "This is not a Vesta export."],
  ["sizeMismatch", `This export is damaged: a file's size does not match the list (${IMG_PATH}).`],
  ["tooLargeFile", `This export is damaged: a file is larger than 100 MB (${IMG_PATH}).`],
];

test.describe("008 US4 — refused files change nothing", () => {
  test("each damaged or foreign file: its message, Settings open, data and backups untouched, logged", async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    addTasks(dataDir, [task({ titleMd: "Mine" }), task({ titleMd: "Archived", doneAt: Date.now() - 1000 })]);
    seedReminders(dataDir, [reminder({ textMd: "Remember" })]);
    const { app, page } = await launchVesta({ dataDir });
    const folder = exportFolder();
    try {
      await expect(taskCard(page, "Mine")).toBeVisible();
      await expect.poll(() => existsSync(join(dataDir, "backups", "latest.json"))).toBe(true);
      const before = snapshotOf(dataDir);
      const latest = readFileSync(join(dataDir, "backups", "latest.json"), "utf8");
      for (const [variant, message] of REFUSED) {
        const zip = join(folder, `${variant}.zip`);
        writeDamaged(zip, variant);
        expect(await importVia(app, page, zip), variant).toBe("kept");
        await expect(status(page), variant).toHaveText(message);
        await expect(status(page)).toHaveClass(/err/);
        await expect(page.locator("dialog.settings-dialog[open]")).toBeVisible();
        expect(snapshotDiff(before, snapshotOf(dataDir)), variant).toEqual([]);
        expect(readdirSync(join(dataDir, "backups")).filter((f) => f.startsWith("pre-import")), variant).toEqual([]);
        expect(readFileSync(join(dataDir, "backups", "latest.json"), "utf8"), variant).toBe(latest);
      }
      const log = readdirSync(join(dataDir, "logs")).map((f) => readFileSync(join(dataDir, "logs", f), "utf8")).join("");
      expect(log.split("import.refused").length - 1).toBeGreaterThanOrEqual(REFUSED.length);
    } finally {
      await app.close();
    }
  });

  test("an entry that tries to leave the folder is ignored; the rest imports (FR-023)", async () => {
    const { app, page, dataDir } = await launchVesta();
    const folder = exportFolder();
    try {
      const zip = join(folder, "traversal.zip");
      writeDamaged(zip, "traversalEntry");
      expect(await importVia(app, page, zip)).toBe("merged");
      await expect(taskCard(page, "From the export")).toBeVisible();
      expect(existsSync(join(folder, "evil.txt"))).toBe(false);
      expect(existsSync(join(dataDir, "..", "evil.txt"))).toBe(false);
    } finally {
      await app.close();
    }
  });
});

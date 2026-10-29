// 008 runbook card step L, automated (quickstart 1–4, 19; SC-007; tasks T062). Nothing is checked by hand.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { writeDamaged, IMG_PATH } from "../unit/fixtures/damage";
import { snapshotDiff } from "../unit/fixtures/export-compare";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { exportFolder, exportVia, importVia, nextDialog, notice, seedFullProfile, snapshotOf, status, zipEntries } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, addTasks, task } from "./fixtures/seed";
import { openSettings } from "./fixtures/settings";

const only = (folder: string) => join(folder, readdirSync(folder)[0] ?? "");

test.describe("008 runbook card step L", () => {
  test("1. Export, then list the zip: data.json and assets/, plus logs/ only when ticked", async () => {
    const dataDir = freshDataDir();
    seedFullProfile(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const plain = exportFolder();
      await exportVia(app, page, plain);
      const entries = await zipEntries(only(plain));
      expect(entries).toContain("data.json");
      expect(entries.filter((e) => e.startsWith("assets/"))).toHaveLength(2);
      expect(entries.some((e) => e.startsWith("logs/"))).toBe(false);
      const withLogs = exportFolder();
      await exportVia(app, page, withLogs, { includeLogs: true });
      expect((await zipEntries(only(withLogs))).some((e) => e.startsWith("logs/"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("2. Import into a fresh data folder: everything appears with formatting and images", async () => {
    const source = freshDataDir();
    seedFullProfile(source);
    const a = await launchVesta({ dataDir: source });
    const folder = exportFolder();
    try {
      await exportVia(a.app, a.page, folder);
    } finally {
      await a.app.close();
    }
    const b = await launchVesta();
    try {
      expect(await importVia(b.app, b.page, only(folder))).toBe("merged");
      await expect(taskCard(b.page, "Parent collapsed").locator("strong")).toHaveText("Parent");
      await taskCard(b.page, "Parent collapsed").locator(".title").click();
      const img = b.page.getByRole("complementary").locator("img[alt='twice']").first();
      await expect(img).toBeVisible();
      expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(snapshotDiff(snapshotOf(source), snapshotOf(b.dataDir))).toEqual([]);
    } finally {
      await b.app.close();
    }
  });

  test("3. Edit a task in each of two folders, export both, import each into the other: the newer edit wins both times", async () => {
    const id = "00000000-0000-4000-8000-00000000c0de";
    const t0 = Date.now() - DAY;
    const a = freshDataDir();
    const b = freshDataDir();
    addTasks(a, [task({ id, titleMd: "Older edit in A", createdAt: t0, updatedAt: t0 + 1_000 })]);
    addTasks(b, [task({ id, titleMd: "Newer edit in B", createdAt: t0, updatedAt: t0 + 2_000 })]);
    const zipOf = async (dir: string) => {
      const launched = await launchVesta({ dataDir: dir });
      const folder = exportFolder();
      try {
        await exportVia(launched.app, launched.page, folder);
      } finally {
        await launched.app.close();
      }
      return only(folder);
    };
    const zipA = await zipOf(a);
    const zipB = await zipOf(b);
    for (const [dir, zip] of [
      [a, zipB],
      [b, zipA],
    ] as const) {
      const { app, page } = await launchVesta({ dataDir: dir });
      try {
        await importVia(app, page, zip);
        await expect(taskCard(page, "Newer edit in B")).toBeVisible();
        expect(readTask(dir, id)?.title_md).toBe("Newer edit in B");
      } finally {
        await app.close();
      }
    }
  });

  test("4. A zip with one byte changed in an asset is refused before anything is written", async () => {
    const dataDir = freshDataDir();
    addTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const before = snapshotOf(dataDir);
      const zip = join(exportFolder(), "damaged.zip");
      writeDamaged(zip, "changedByte");
      expect(await importVia(app, page, zip)).toBe("kept");
      await expect(status(page)).toHaveText(`This export is damaged: a file does not match its checksum (${IMG_PATH}).`);
      expect(snapshotDiff(before, snapshotOf(dataDir))).toEqual([]);
      expect(readdirSync(join(dataDir, "backups")).some((f) => f.startsWith("pre-import"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  test("19. Export and import each take at most three actions from an open Settings (SC-007)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      // Export: 1 the button, 2–3 pick the folder and confirm (the picker answers through the test hook).
      await nextDialog(app, exportFolder());
      await page.getByTestId("export").click();
      await expect(status(page)).toContainText("Saved vesta-export-");
      // Import: 1 the button, 2–3 pick the file and confirm; nothing else is asked.
      const zip = join(exportFolder(), "valid.zip");
      writeDamaged(zip, "valid");
      await nextDialog(app, zip);
      await page.getByTestId("import").click();
      await expect(notice(page)).toHaveAttribute("data-kind", "importUndo");
    } finally {
      await app.close();
    }
  });
});

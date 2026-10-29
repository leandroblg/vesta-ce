// 010 US3 (M2, L10, L14; FR-004, FR-012 to FR-014): an import cannot smuggle in what the user did not export.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { toExportJson, type ExportData } from "../../src/domain/export/format";
import { snapshotDiff } from "../unit/fixtures/export-compare";
import { writeZip } from "../unit/fixtures/zip";
import { taskCard } from "./fixtures/alerts";
import { exportFolder, importVia, snapshotOf, status } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { openSettings } from "./fixtures/settings";
import { addTasks, task } from "./fixtures/seed";

const YEAR = 365 * 86_400_000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

function exportOf(over: Partial<ExportData>): ExportData {
  return { appVersion: "0.9.0", exportedAt: Date.now(), tasks: [], reminders: [], settings: [], assets: [], ...over };
}

function setting(dataDir: string, key: string): string | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}

function logText(dataDir: string): string {
  return readdirSync(join(dataDir, "logs"))
    .map((f) => readFileSync(join(dataDir, "logs", f), "utf8"))
    .join("");
}

const contentType = (app: ElectronApplication, url: string) =>
  app.evaluate(({ net }, u) => net.fetch(u).then((r) => ({ status: r.status, type: r.headers.get("content-type") })), url);

test.describe("010 US3 — an import cannot smuggle in what I did not export", () => {
  test("L14 future times become the import moment, and an import never turns the automatic update check on", async () => {
    const dataDir = freshDataDir();
    addTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir });
    const folder = exportFolder();
    try {
      await openSettings(page, "Updates");
      await page.getByTestId("auto-update").click();
      await expect(page.getByTestId("auto-update")).not.toBeChecked();
      const future = task({ titleMd: "From the future", createdAt: Date.now() + YEAR, updatedAt: Date.now() + 2 * YEAR });
      future.staleBaseAt = future.createdAt;
      const zip = join(folder, "future.zip");
      await writeZip(zip, {
        "data.json": toExportJson(exportOf({ tasks: [future], settings: [{ key: "autoUpdateCheck", value: true, updatedAt: Date.now() + YEAR }] })),
      });
      const started = Date.now();
      expect(await importVia(app, page, zip)).toBe("merged");
      await expect(taskCard(page, "From the future")).toBeVisible();
      const imported = snapshotOf(dataDir).tasks.find((t) => t.id === future.id);
      expect(imported).toBeDefined();
      expect(imported?.updatedAt).toBeLessThanOrEqual(Date.now());
      expect(imported?.updatedAt).toBeGreaterThanOrEqual(started - 1_000);
      expect(imported?.createdAt).toBeLessThanOrEqual(Date.now());
      expect(setting(dataDir, "autoUpdateCheck")).toBe("false");
      await expect.poll(() => logText(dataDir)).toContain('"import.clamped-times"');
    } finally {
      await app.close();
    }
  });

  test("M2 a declared type is ignored: the stored file is served as what its bytes are", async () => {
    const dataDir = freshDataDir();
    addTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir });
    const folder = exportFolder();
    try {
      const incoming = task({ titleMd: "With image", detailsMd: `![i](assets/${PNG_SHA}.png)` });
      const zip = join(folder, "typed.zip");
      await writeZip(zip, {
        "data.json": toExportJson(exportOf({ tasks: [incoming], assets: [{ sha256: PNG_SHA, ext: "png", mimeType: "text/html", size: PNG.length }] })),
        [`assets/${PNG_SHA}.png`]: PNG,
      });
      expect(await importVia(app, page, zip)).toBe("merged");
      expect(snapshotOf(dataDir).files[PNG_SHA]?.mimeType).toBe("image/png");
      const served = await contentType(app, `vesta-asset://assets/${PNG_SHA}.png`);
      expect(served).toEqual({ status: 200, type: "image/png" });
    } finally {
      await app.close();
    }
  });

  test("L10 a data.json over 64 MiB is refused as damaged before anything is written", async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    addTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir });
    const folder = exportFolder();
    try {
      const before = snapshotOf(dataDir);
      const zip = join(folder, "huge.zip");
      await writeZip(zip, { "data.json": Buffer.alloc(64 * 1024 * 1024 + 1, 0x20) });
      expect(await importVia(app, page, zip)).toBe("kept");
      await expect(status(page)).toHaveText("This export is damaged: its data.json is too large.");
      expect(snapshotDiff(before, snapshotOf(dataDir))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("L10 without enough free space the import is refused and Settings stays open", async () => {
    const dataDir = freshDataDir();
    addTasks(dataDir, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_TEST_FREE_BYTES: "0" } });
    const folder = exportFolder();
    try {
      const before = snapshotOf(dataDir);
      const zip = join(folder, "small.zip");
      await writeZip(zip, { "data.json": toExportJson(exportOf({ tasks: [task({ titleMd: "Theirs" })] })) });
      expect(await importVia(app, page, zip)).toBe("kept");
      await expect(status(page)).toHaveText("There is not enough free space on this disk for this import.");
      await expect(page.locator("dialog.settings-dialog[open]")).toBeVisible();
      expect(snapshotDiff(before, snapshotOf(dataDir))).toEqual([]);
      expect(readdirSync(join(dataDir, "backups")).filter((f) => f.startsWith("pre-import"))).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

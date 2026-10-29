// 008 US1: export all my data to one file (US1-1 to US1-6; quickstart 6, 7; tasks T037).
import { chmodSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { parseExport } from "../../src/domain/export/parse";
import { readZip } from "../unit/fixtures/zip";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { typeIn } from "./fixtures/editor";
import { exportFolder, exportVia, nextDialog, status, zipEntries } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { addTasks, seedAsset, seedTasks, task } from "./fixtures/seed";
import { openSettings } from "./fixtures/settings";

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.describe("008 US1 — export", () => {
  test("Export saves vesta-export-<date>.zip in the picked folder and names it (US1-1)", async () => {
    const { app, page } = await launchVesta();
    try {
      const folder = exportFolder();
      const text = await exportVia(app, page, folder);
      const name = `vesta-export-${today()}.zip`;
      expect(text).toBe(`Saved ${name} in ${folder}.`);
      expect(readdirSync(folder)).toEqual([name]);
    } finally {
      await app.close();
    }
  });

  test("cancelling the picker writes nothing and shows nothing (US1-2)", async () => {
    const { app, page } = await launchVesta();
    try {
      expect(await exportVia(app, page, null)).toBe("");
    } finally {
      await app.close();
    }
  });

  test("an existing file is never overwritten: -2 (US1-3)", async () => {
    const { app, page } = await launchVesta();
    try {
      const folder = exportFolder();
      writeFileSync(join(folder, `vesta-export-${today()}.zip`), "keep");
      await exportVia(app, page, folder);
      expect(readdirSync(folder).sort()).toEqual([`vesta-export-${today()}-2.zip`, `vesta-export-${today()}.zip`]);
    } finally {
      await app.close();
    }
  });

  test("an image and a PDF in details and an image of a Trash task are each in the zip once, byte for byte (US1-4)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, []);
    const img = seedAsset(dataDir, Buffer.from("image-one"), "png", "image/png");
    const pdf = seedAsset(dataDir, Buffer.from("%PDF-1.4 x"), "pdf", "application/pdf");
    const trash = seedAsset(dataDir, Buffer.from("image-two"), "png", "image/png");
    addTasks(dataDir, [
      task({ titleMd: "With files", detailsMd: `![i](${img}) [doc.pdf](${pdf})` }),
      task({ titleMd: "Deleted", detailsMd: `![t](${trash})`, deletedAt: Date.now() }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const folder = exportFolder();
      await exportVia(app, page, folder);
      const zipPath = join(folder, `vesta-export-${today()}.zip`);
      expect(await zipEntries(zipPath)).toEqual(["data.json", img, pdf, trash].sort());
      const zip = await readZip(zipPath);
      expect(zip.get(img)?.data.toString()).toBe("image-one");
      expect(zip.get(pdf)?.data.toString()).toBe("%PDF-1.4 x");
      expect(zip.get(trash)?.data.toString()).toBe("image-two");
    } finally {
      await app.close();
    }
  });

  test("a details edit still waiting for its save is saved first and exported (US1-5, FR-011)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Pending" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Pending").locator(".title").click();
      const details = page.getByRole("complementary", { name: "Details" }).getByRole("textbox", { name: "Details" });
      await typeIn(details, "typed just before export");
      const folder = exportFolder();
      await exportVia(app, page, folder);
      expect(readTask(dataDir, a.id)?.details_md).toBe("typed just before export");
      const zip = await readZip(join(folder, `vesta-export-${today()}.zip`));
      const parsed = parseExport(zip.get("data.json")?.data.toString() ?? "");
      expect(parsed.ok && parsed.data.tasks[0]?.detailsMd).toBe("typed just before export");
    } finally {
      await app.close();
    }
  });

  test("a folder that cannot be written: the message, no partial file, logged (US1-6, FR-017)", async () => {
    const { app, page, dataDir } = await launchVesta();
    const folder = exportFolder();
    chmodSync(folder, 0o555);
    try {
      expect(await exportVia(app, page, folder)).toBe("The export could not be saved.");
      await expect(status(page)).toHaveClass(/err/);
      chmodSync(folder, 0o755);
      expect(readdirSync(folder)).toEqual([]);
      const logged = readdirSync(join(dataDir, "logs")).some((f) => readFileSync(join(dataDir, "logs", f), "utf8").includes("export.failed"));
      expect(logged).toBe(true);
    } finally {
      chmodSync(folder, 0o755);
      await app.close();
    }
  });

  test("a referenced file missing on disk is left out and counted (quickstart 6, Q118)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, []);
    const ref = seedAsset(dataDir, Buffer.from("will vanish"), "png", "image/png");
    rmSync(join(dataDir, ref));
    addTasks(dataDir, [task({ titleMd: "Missing file", detailsMd: `![x](${ref})` })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const folder = exportFolder();
      const text = await exportVia(app, page, folder);
      expect(text).toContain("1 file could not be included");
      const zipPath = join(folder, `vesta-export-${today()}.zip`);
      expect(await zipEntries(zipPath)).toEqual(["data.json"]);
      expect(existsSync(zipPath)).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("both buttons are enabled again once an export ends (FR-003; the busy state is checked with a slow import in us-export-safety)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      await nextDialog(app, exportFolder());
      const exportButton = page.getByTestId("export");
      await exportButton.click();
      await expect(page.getByTestId("import")).toBeEnabled();
      await expect(exportButton).toBeEnabled();
    } finally {
      await app.close();
    }
  });
});

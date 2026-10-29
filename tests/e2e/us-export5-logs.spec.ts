// 008 US5: include my logs for troubleshooting (US5-1 to US5-3; FR-015, FR-024; SC-008; tasks T060).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { readZip } from "../unit/fixtures/zip";
import { exportFolder, exportVia, importVia, nextDialog, zipEntries } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedLogs } from "./fixtures/logs";
import { clickMenu } from "./fixtures/menu";
import { closeSettings, openSettings } from "./fixtures/settings";

test.describe("008 US5 — logs in the export", () => {
  test("Include logs is unticked each time Settings opens (US5-1)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      const box = page.getByTestId("include-logs");
      await expect(box).not.toBeChecked();
      await box.check();
      await closeSettings(page);
      await openSettings(page, "Data");
      await expect(page.getByTestId("include-logs")).not.toBeChecked();
    } finally {
      await app.close();
    }
  });

  test("013 T112 FR-003 File › Export… with Settings open at Data uses the pane's Include logs choice", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      await page.getByTestId("include-logs").check();
      const folder = exportFolder();
      await nextDialog(app, folder);
      await clickMenu(app, "export");
      await expect.poll(() => readdirSync(folder).length, { timeout: 60_000 }).toBe(1);
      await expect(page.getByTestId("export")).toBeEnabled({ timeout: 60_000 });
      expect((await zipEntries(join(folder, readdirSync(folder)[0] ?? ""))).some((n) => n.startsWith("logs/"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("logs/ is in the zip if and only if ticked, with every log file as it was (US5-2, SC-008)", async () => {
    const { app, page, dataDir } = await launchVesta();
    try {
      const without = exportFolder();
      await exportVia(app, page, without);
      const plain = join(without, readdirSync(without)[0] ?? "");
      expect((await zipEntries(plain)).some((n) => n.startsWith("logs/"))).toBe(false);

      const withLogs = exportFolder();
      await exportVia(app, page, withLogs, { includeLogs: true });
      const zip = await readZip(join(withLogs, readdirSync(withLogs)[0] ?? ""));
      const logNames = readdirSync(join(dataDir, "logs")).sort();
      expect([...zip.keys()].filter((n) => n.startsWith("logs/")).sort()).toEqual(logNames.map((n) => `logs/${n}`));
      // The zip's copy is the start of the live file (the export writes its own lines after copying).
      for (const name of logNames) {
        const copied = zip.get(`logs/${name}`)?.data.toString("utf8") ?? "";
        expect(readFileSync(join(dataDir, "logs", name), "utf8").startsWith(copied)).toBe(true);
        expect(copied.length).toBeGreaterThan(0);
      }
    } finally {
      await app.close();
    }
  });

  test("an imported zip's logs are not merged, copied or shown (US5-3, FR-024)", async () => {
    const source = await launchVesta();
    const folder = exportFolder();
    try {
      await exportVia(source.app, source.page, folder, { includeLogs: true });
    } finally {
      await source.app.close();
    }
    const zip = join(folder, readdirSync(folder)[0] ?? "");
    const marker = (await readZip(zip)).get(`logs/${readdirSync(join(source.dataDir, "logs"))[0] ?? ""}`)?.data.toString("utf8") ?? "";
    expect(marker).toContain(source.dataDir); // the source's own start line names its data folder

    const target = await launchVesta();
    try {
      expect(await importVia(target.app, target.page, zip)).toBe("merged");
      const local = readdirSync(join(target.dataDir, "logs")).map((n) => readFileSync(join(target.dataDir, "logs", n), "utf8")).join("");
      expect(local).not.toContain(source.dataDir);
      expect(local).toContain("import.merged");
    } finally {
      await target.app.close();
    }
  });

  test("009: after rotation, Include logs carries every vesta-NNN.log with whole lines only (T063)", async () => {
    const dataDir = freshDataDir();
    seedLogs(dataDir, { numbers: [998, 999, 1, 2], perFile: 200 });
    const { app, page } = await launchVesta({ dataDir });
    try {
      const folder = exportFolder();
      await exportVia(app, page, folder, { includeLogs: true });
      const zip = await readZip(join(folder, readdirSync(folder)[0] ?? ""));
      const inZip = [...zip.keys()].filter((n) => n.startsWith("logs/")).sort();
      expect(inZip).toEqual(["logs/vesta-001.log", "logs/vesta-002.log", "logs/vesta-998.log", "logs/vesta-999.log"]);
      for (const name of inZip) {
        const text = zip.get(name)?.data.toString("utf8") ?? "";
        expect(text.endsWith("\n"), name).toBe(true);
        for (const line of text.split("\n").filter((l) => l !== "")) expect(() => JSON.parse(line) as unknown, name).not.toThrow();
      }
    } finally {
      await app.close();
    }
  });
});

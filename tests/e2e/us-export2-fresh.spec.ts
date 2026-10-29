// 008 US2: bring my data into a new installation (US2-1 to US2-6; FR-020, FR-040, SC-006; tasks T048).
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { toExportJson } from "../../src/domain/export/format";
import { writeZip } from "../unit/fixtures/zip";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { exportFolder, exportVia, importVia, notice, status } from "./fixtures/export";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { PNG } from "./fixtures/md-corpus";
import { DAY, addTasks, reminder, seedAsset, seedReminders, seedSetting, staleTask, task } from "./fixtures/seed";
import { MOD } from "./fixtures/settings";

/** A source profile with the US2 cases, exported; returns the zip and the ids that matter. */
async function sourceExport(): Promise<{ zip: string; staleId: string; staleBlink: number }> {
  const dir = freshDataDir();
  const image = seedAsset(dir, PNG, "png", "image/png");
  const now = Date.now();
  const parent = task({ titleMd: "**Bold** parent", position: 1, collapsed: true });
  const stale = staleTask({ titleMd: "Old and stale", position: 2, lastBlinkAt: now - 10 * 60_000 });
  addTasks(dir, [
    parent,
    task({ titleMd: "Hidden child", parentId: parent.id, position: 1 }),
    stale,
    task({ titleMd: "With image", position: 3, detailsMd: `![pic](${image})\n\nzanzibarquest` }),
    task({ titleMd: "Archived one", doneAt: now - DAY, position: 4 }),
    task({ titleMd: "Trashed one", deletedAt: now - 3 * DAY, position: 5 }),
  ]);
  seedReminders(dir, [reminder({ textMd: "A reminder", position: 1 })]);
  seedSetting(dir, "theme", "dark");
  seedSetting(dir, "language", "it");
  seedSetting(dir, "shortcuts", { newTask: ["Mod+Alt+N"] });
  seedSetting(dir, "alertPeriodMin", 120);
  const a = await launchVesta({ dataDir: dir });
  const folder = exportFolder();
  try {
    await exportVia(a.app, a.page, folder);
  } finally {
    await a.app.close();
  }
  return { zip: join(folder, readdirSync(folder)[0] ?? ""), staleId: stale.id, staleBlink: readTask(dir, stale.id)?.last_blink_at ?? 0 };
}

const darkTheme = (app: ElectronApplication) => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);

async function importFresh(zip: string): Promise<{ app: ElectronApplication; page: Page; dataDir: string; tookMs: number }> {
  const launched = await launchVesta();
  const start = Date.now();
  expect(await importVia(launched.app, launched.page, zip)).toBe("merged");
  return { ...launched, tookMs: Date.now() - start };
}

test.describe("008 US2 — import into a new installation", () => {
  test("everything appears in the main view, Archive and Trash with order, nesting, collapse and dates (US2-1)", async () => {
    const { zip } = await sourceExport();
    const { app, page } = await importFresh(zip);
    try {
      await expect(page.locator("html")).toHaveAttribute("lang", "it");
      await expect(taskCard(page, "Bold parent")).toBeVisible();
      await expect(taskCard(page, "Hidden child")).toHaveCount(0); // still collapsed
      // The stale group comes first (003 FR-024), as in the exporting installation.
      const staleY = (await taskCard(page, "Old and stale").boundingBox())?.y ?? 0;
      const parentY = (await taskCard(page, "Bold parent").boundingBox())?.y ?? 0;
      expect(staleY).toBeLessThan(parentY);
      await page.getByRole("button", { name: "Archivio" }).click();
      await expect(page.getByText("Archived one")).toBeVisible();
      await page.getByRole("button", { name: "Cestino" }).click();
      await expect(page.getByText("Trashed one")).toBeVisible();
      await expect(page.getByText("27 giorni rimasti")).toBeVisible(); // from the original deletion date
    } finally {
      await app.close();
    }
  });

  test("formatting renders and the image loads from the imported copy (US2-2)", async () => {
    const { zip } = await sourceExport();
    const { app, page } = await importFresh(zip);
    try {
      await expect(taskCard(page, "Bold parent").locator("strong")).toHaveText("Bold");
      await taskCard(page, "With image").locator(".title").click();
      const img = page.getByRole("complementary").locator("img[alt='pic']");
      await expect(img).toBeVisible();
      expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  test("the imported settings apply at once: theme, language, shortcut (US2-3, FR-040)", async () => {
    const { zip } = await sourceExport();
    const { app, page } = await importFresh(zip);
    try {
      expect(await darkTheme(app)).toBe("dark");
      await expect(page.locator("html")).toHaveAttribute("lang", "it");
      await page.keyboard.press(`${MOD}+Alt+KeyN`);
      await expect(page.locator("li.newcard textarea, li.newcard [contenteditable='true']").first()).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("a stale task stays stale and keeps its imported last blink (US2-4)", async () => {
    const { zip, staleId, staleBlink } = await sourceExport();
    const { app, page, dataDir } = await importFresh(zip);
    try {
      await expect(taskCard(page, "Old and stale")).toHaveClass(/stale/);
      expect(readTask(dataDir, staleId)?.last_blink_at).toBe(staleBlink);
      expect(readTask(dataDir, staleId)?.stale_since).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  test("search finds imported text, and everything survives a restart (US2-5, US2-6)", async () => {
    const { zip } = await sourceExport();
    const launched = await importFresh(zip);
    await launched.page.getByRole("searchbox").fill("zanzibarquest");
    await expect(taskCard(launched.page, "With image")).toBeVisible();
    const again = await relaunch(launched);
    try {
      await expect(taskCard(again.page, "Bold parent")).toBeVisible();
      await expect(again.page.locator("html")).toHaveAttribute("lang", "it");
    } finally {
      await again.app.close();
    }
  });

  test("the merged data shows within 1 s of the reply, and cancelling the picker changes nothing (SC-006, FR-020)", async () => {
    const { zip } = await sourceExport();
    const { app, page, tookMs } = await importFresh(zip);
    try {
      expect(tookMs).toBeLessThan(5_000);
      await expect(taskCard(page, "Bold parent")).toBeVisible({ timeout: 1_000 });
      await expect(notice(page)).toBeVisible();
    } finally {
      await app.close();
    }
    const fresh = await launchVesta();
    try {
      expect(await importVia(fresh.app, fresh.page, null)).toBe("kept");
      await expect(status(fresh.page)).toHaveText("");
      expect(readdirSync(join(fresh.dataDir, "backups")).filter((f) => f.startsWith("pre-import"))).toEqual([]);
    } finally {
      await fresh.app.close();
    }
  });

  test("a linked file resolves to the stored copy under another extension; 010 M4 shows a .dat copy in the file manager (US2-2, FR-034)", async () => {
    const pdf = Buffer.from("%PDF-1.4 same content");
    const sha = createHash("sha256").update(pdf).digest("hex");
    const zip = join(exportFolder(), "linked.zip");
    const linked = task({ titleMd: "Has a link", detailsMd: `[contract.pdf](assets/${sha}.pdf)` });
    await writeZip(zip, {
      "data.json": toExportJson({
        appVersion: "0.8.0",
        exportedAt: Date.now(),
        tasks: [linked],
        reminders: [],
        settings: [],
        assets: [{ sha256: sha, ext: "pdf", mimeType: "application/pdf", size: pdf.length }],
      }),
      [`assets/${sha}.pdf`]: pdf,
    });
    const dataDir = freshDataDir();
    // The same content, already stored here under another name and in use (else the purge at launch removes it).
    const local = seedAsset(dataDir, pdf, "dat");
    addTasks(dataDir, [task({ titleMd: "Uses the local copy", detailsMd: `[local.dat](${local})` })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await app.evaluate(({ shell }) => {
        const g = globalThis as unknown as { opened: string[] };
        g.opened = [];
        shell.openPath = (p: string) => {
          g.opened.push(p);
          return Promise.resolve("");
        };
        shell.showItemInFolder = (p: string) => {
          g.opened.push(`shown ${p}`);
        };
      });
      expect(await importVia(app, page, zip)).toBe("merged");
      await taskCard(page, "Has a link").locator(".title").click();
      const link = page.getByRole("complementary", { name: "Details" }).locator("a", { hasText: "contract.pdf" });
      await link.click({ modifiers: ["ControlOrMeta"] });
      await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([`shown ${join(dataDir, "assets", `${sha}.dat`)}`]); // 010 FR-006 (M4): .dat is not allow-listed, so it is shown in the file manager
    } finally {
      await app.close();
    }
  });
});


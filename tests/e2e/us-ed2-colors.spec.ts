// 011 US2: one color picker with my own colors (quickstart scenarios 5 to 9, tasks T047).
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { toExportJson, type ExportData } from "../../src/domain/export/format";
import { writeZip } from "../unit/fixtures/zip";
import { readTask } from "./fixtures/clock";
import { colorPicker, openHighlightPicker, openTextColorPicker, pickCustomColor, selectText } from "./fixtures/editor";
import { exportFolder, exportVia, importVia } from "./fixtures/export";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { seedSettings, seedTasks, task } from "./fixtures/seed";
import { closeSettings, setTheme } from "./fixtures/settings";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const swatch = (page: Page, section: string, hex: string) => colorPicker(page).locator(`[data-section="${section}"][data-hex="${hex}"]`);

function setting(dataDir: string, key: string): unknown {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
  } finally {
    db.close();
  }
}

async function launch(titleMd: string, detailsMd = "", settings: Record<string, unknown> = {}) {
  const dataDir = freshDataDir();
  const a = task({ titleMd, detailsMd });
  seedTasks(dataDir, [a]);
  if (Object.keys(settings).length > 0) seedSettings(dataDir, Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, JSON.stringify(v)])));
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

async function openDetails(page: Page) {
  await card(page).locator(".title").click();
  const editor = details(page);
  await editor.click();
  return editor;
}

const hex = (n: number) => `#0000${n.toString(16).padStart(2, "0")}ff`;

test.describe("011 US2 — the color picker", () => {
  test("FR-008 FR-010 FR-009 FR-014 SC-002 preset, custom and Automatic; text and highlight share the lists; a recent color in 2 actions", async () => {
    const { app, page, dataDir, id } = await launch("Colors", "alpha beta gamma");
    try {
      const editor = await openDetails(page);
      await selectText(editor, "alpha");
      await openTextColorPicker(page);
      await expect(colorPicker(page)).toHaveAttribute("aria-label", "Text color");
      await expect(colorPicker(page).locator("[role='gridcell']")).toHaveCount(100);
      await colorPicker(page).getByRole("gridcell", { name: "Blue 600" }).click();
      await expect(colorPicker(page)).toHaveCount(0);

      await selectText(editor, "beta");
      await pickCustomColor(page, "Text color", "#336699");

      // FR-014: the highlight picker shows the same recent list.
      await selectText(editor, "gamma");
      await openHighlightPicker(page);
      await expect(swatch(page, "recent", "#336699ff")).toBeVisible();
      await page.keyboard.press("Escape");

      // SC-002: a recent color is reapplied in 2 actions: open the picker, choose the swatch.
      let actionsTaken = 0;
      await openTextColorPicker(page);
      actionsTaken++;
      await swatch(page, "recent", "#336699ff").click();
      actionsTaken++;
      expect(actionsTaken).toBe(2);

      // US2-2: the first choice removes the color and stores nothing; 012 FR-020 names it Remove color.
      await selectText(editor, "alpha");
      await openTextColorPicker(page);
      await colorPicker(page).getByRole("button", { name: "Remove color" }).click();
      await expect.poll(() => readTask(dataDir, id)?.details_md).toBe('alpha [beta]{color="#336699ff"} [gamma]{color="#336699ff"}');
      expect(setting(dataDir, "recentColors")).toEqual(["#336699ff"]);
    } finally {
      await app.close();
    }
  });

  test("US2-5 to US2-10 recent rows, pinning by drag and Shift+Enter, reordering, unpinning; the lists survive a restart", async () => {
    const recent = Array.from({ length: 20 }, (_, i) => hex(i + 1));
    const run = await launch("Lists", "word", { recentColors: recent, pinnedColors: [{ hex: "#123456ff", at: 1 }] });
    let { app, page } = run;
    try {
      const editor = await openDetails(page);
      await selectText(editor, "word");
      await openTextColorPicker(page);
      await expect(colorPicker(page).locator("[data-section='recent'][role='option']")).toHaveCount(20);
      // HTML drag and drop with a real DataTransfer (mouse-driven native drags are not simulated here).
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await swatch(page, "recent", hex(5)).dispatchEvent("dragstart", { dataTransfer: transfer });
      await colorPicker(page).locator(".cp-pinned").dispatchEvent("dragover", { dataTransfer: transfer });
      await colorPicker(page).locator(".cp-pinned").dispatchEvent("drop", { dataTransfer: transfer });
      await expect(colorPicker(page).locator("[data-section='pinned'][role='option']").first()).toHaveAttribute("data-hex", hex(5));
      await swatch(page, "preset", "#ef4444ff").press("Shift+Enter");
      await expect(colorPicker(page).locator("[data-section='pinned'][role='option']").first()).toHaveAttribute("data-hex", "#ef4444ff");
      await swatch(page, "pinned", "#ef4444ff").press("Alt+ArrowRight");
      await expect(colorPicker(page).locator("[data-section='pinned'][role='option']").nth(1)).toHaveAttribute("data-hex", "#ef4444ff");
      await swatch(page, "pinned", "#123456ff").press("Delete");
      await expect(swatch(page, "pinned", "#123456ff")).toHaveCount(0);
      await expect(colorPicker(page)).toBeVisible();
      await expect.poll(() => (setting(run.dataDir, "pinnedColors") as { hex: string }[]).map((e) => e.hex)).toEqual([hex(5), "#ef4444ff"]);
      expect(setting(run.dataDir, "recentColors")).toEqual(recent.filter((h) => h !== hex(5)));

      ({ app, page } = await relaunch({ ...run, app, page }));
      await openDetails(page);
      await selectText(details(page), "word");
      await openHighlightPicker(page);
      await expect(colorPicker(page).locator("[data-section='pinned'][role='option']")).toHaveCount(2);
      await expect(colorPicker(page).locator("[data-section='recent'][role='option']")).toHaveCount(19);
    } finally {
      await app.close();
    }
  });

  test("SC-004 FR-017 the lists and the rows-first setting travel through an export; an export with 11 pins is refused", async () => {
    const pinned = [{ hex: "#ef4444ff", at: 5 }, { hex: "#123456ff", at: 3 }];
    const source = await launch("Export", "", { pinnedColors: pinned, recentColors: ["#336699ff"], tableRowsFirst: true });
    const folder = exportFolder();
    let zip: string;
    try {
      const shown = await exportVia(source.app, source.page, folder);
      expect(shown).toContain("Saved");
      zip = join(folder, (await import("node:fs")).readdirSync(folder).find((f) => f.endsWith(".zip")) as string);
    } finally {
      await source.app.close();
    }
    const target = await launchVesta({ dataDir: freshDataDir() });
    try {
      expect(await importVia(target.app, target.page, zip)).toBe("merged");
      expect(setting(target.dataDir, "pinnedColors")).toEqual(pinned);
      expect(setting(target.dataDir, "recentColors")).toEqual(["#336699ff"]);
      expect(setting(target.dataDir, "tableRowsFirst")).toBe(true);

      const bad = join(folder, "bad.zip");
      const data: ExportData = {
        appVersion: "0.9.0",
        exportedAt: Date.now(),
        tasks: [],
        reminders: [],
        assets: [],
        settings: [{ key: "pinnedColors", value: Array.from({ length: 11 }, (_, i) => ({ hex: hex(i), at: 1 })), updatedAt: Date.now() }],
      };
      await writeZip(bad, { "data.json": toExportJson(data) });
      expect(await importVia(target.app, target.page, bad)).toBe("kept");
      expect(setting(target.dataDir, "pinnedColors")).toEqual(pinned);
      await closeSettings(target.page);
    } finally {
      await target.app.close();
    }
  });

  test("US2-14 FR-015 stored 3- and 6-digit colors are rewritten once at the first start; code and updated_at untouched", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: '[pass]{color="#d33"}', detailsMd: '[x]{bg="#ffe066"} and [y]{bg="#ffe06680"}\n\n```\n[z]{color="#d33"}\n```' });
    seedTasks(dataDir, [a]);
    const before = readTask(dataDir, a.id);
    const { app } = await launchVesta({ dataDir });
    try {
      await expect.poll(() => readTask(dataDir, a.id)?.title_md).toBe('[pass]{color="#dd3333ff"}');
      const after = readTask(dataDir, a.id);
      expect(after?.details_md).toBe('[x]{bg="#ffe066ff"} and [y]{bg="#ffe06680"}\n\n```\n[z]{color="#d33"}\n```');
      expect(after?.updated_at).toBe(before?.updated_at);
    } finally {
      await app.close();
    }
  });

  test("US2-2 US2-15 US2-16 FR-009 colors are drawn readable in each theme; the stored text never changes", async () => {
    const title = '[pale]{color="#f3f4f6ff"} [deep]{color="#1f2937ff"} [hy]{bg="#fef3c7ff"} [hg]{bg="#1f2937ff"} auto';
    const { app, page, dataDir, id } = await launch(title);
    try {
      const drawn = (text: string) =>
        card(page)
          .locator("[data-vesta-span]", { hasText: text })
          .evaluate((el: HTMLElement) => ({ color: el.style.color, bg: el.style.backgroundColor }));
      const autoColor = () => card(page).locator(".title").evaluate((el) => getComputedStyle(el).color);

      // Playwright pins a light scheme by default; null hands it back to Electron, so the Theme setting decides.
      await page.emulateMedia({ colorScheme: null });
      await setTheme(page, "Light");
      await closeSettings(page);
      await expect.poll(async () => (await drawn("pale")).color).not.toBe("rgb(243, 244, 246)");
      expect((await drawn("pale")).color).not.toBe("rgb(243, 244, 246)");
      expect((await drawn("deep")).color).toBe("rgb(31, 41, 55)");
      expect((await drawn("hy")).bg).not.toBe("rgb(254, 243, 199)");
      expect((await drawn("hg")).bg).toBe("rgb(31, 41, 55)");
      const lightAuto = await autoColor();

      await setTheme(page, "Dark");
      await closeSettings(page);
      await expect.poll(async () => (await drawn("pale")).color).toBe("rgb(243, 244, 246)");
      expect((await drawn("deep")).color).not.toBe("rgb(31, 41, 55)");
      expect((await drawn("hy")).bg).toBe("rgb(254, 243, 199)");
      expect((await drawn("hg")).bg).not.toBe("rgb(31, 41, 55)");
      expect(await autoColor()).not.toBe(lightAuto);
      expect(readTask(dataDir, id)?.title_md).toBe(title);
    } finally {
      await app.close();
    }
  });
});

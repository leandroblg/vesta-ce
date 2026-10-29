/**
 * 016 User Story 7: a preset or recent color dragged onto the pinned row lands where it is dropped (FR-028 to FR-030;
 * PRD Q223; ui.md "Color picker").
 */
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type JSHandle, type Locator, type Page } from "@playwright/test";
import { colorPicker, openTextColorPicker, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { taskCard } from "./fixtures/alerts";
import { seedSettings, seedTasks, task } from "./fixtures/seed";

const hex = (n: number) => `#0000${n.toString(16).padStart(2, "0")}ff`;
const details = (page: Page) => page.getByRole("complementary", { name: "Details" }).getByRole("textbox", { name: "Details" });
const swatch = (page: Page, section: string, color: string) => colorPicker(page).locator(`[data-section="${section}"][data-hex="${color}"]`);
const pinnedHexes = (page: Page) => colorPicker(page).locator("[data-section='pinned'][role='option']").evaluateAll((els) => els.map((e) => e.getAttribute("data-hex")));

function setting(dataDir: string, key: string): unknown {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
  } finally {
    db.close();
  }
}

async function launch(pinned: string[], recent: string[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Pins", detailsMd: "word" })]);
  // Newest pin first (the row shows them by `at`, latest first).
  seedSettings(dataDir, {
    pinnedColors: JSON.stringify(pinned.map((h, i) => ({ hex: h, at: 1000 - i }))),
    recentColors: JSON.stringify(recent),
  });
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir };
}

async function openPicker(page: Page): Promise<void> {
  await taskCard(page, "Pins").locator(".title").click();
  await selectText(details(page), "word");
  await openTextColorPicker(page);
}

/** HTML drag and drop with a real DataTransfer, dropped at `x` over the pinned row (native drags are not simulated). */
async function dragTo(page: Page, source: Locator, x: number): Promise<void> {
  const transfer: JSHandle<DataTransfer> = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent("dragstart", { dataTransfer: transfer });
  const row = colorPicker(page).locator(".cp-pinned");
  await row.dispatchEvent("dragover", { dataTransfer: transfer, clientX: x });
  await row.dispatchEvent("drop", { dataTransfer: transfer, clientX: x });
}

/** The x of the gap between the n-th and the (n+1)-th pinned swatch (1-based). */
async function gapAfter(page: Page, n: number): Promise<number> {
  const all = colorPicker(page).locator("[data-section='pinned'][role='option']");
  const a = await all.nth(n - 1).boundingBox();
  const b = await all.nth(n).boundingBox();
  if (a === null || b === null) throw new Error("no box");
  return (a.x + a.width + b.x) / 2;
}

test.describe("016 US7 — pinning a color where it is dropped", () => {
  test("a recent color dropped between the 3rd and 4th pinned lands 4th and leaves recent; the pins survive a restart", async () => {
    const pinned = [hex(1), hex(2), hex(3), hex(4), hex(5)];
    const run = await launch(pinned, ["#abcdefff", "#fedcbaff"]);
    let { app, page } = run;
    try {
      await openPicker(page);
      await dragTo(page, swatch(page, "recent", "#abcdefff"), await gapAfter(page, 3));
      await expect.poll(() => pinnedHexes(page)).toEqual([hex(1), hex(2), hex(3), "#abcdefff", hex(4), hex(5)]);
      await expect(swatch(page, "recent", "#abcdefff")).toHaveCount(0);
      await expect.poll(() => (setting(run.dataDir, "pinnedColors") as { hex: string }[]).map((e) => e.hex)).toEqual([hex(1), hex(2), hex(3), "#abcdefff", hex(4), hex(5)]);
      expect(setting(run.dataDir, "recentColors")).toEqual(["#fedcbaff"]);
      await page.keyboard.press("Escape");

      ({ app, page } = await relaunch({ ...run, app, page }));
      await openPicker(page);
      expect(await pinnedHexes(page)).toEqual([hex(1), hex(2), hex(3), "#abcdefff", hex(4), hex(5)]);
    } finally {
      await app.close();
    }
  });

  test("with ten pinned a dropped preset lands in place and the rightmost goes; Shift+Enter on a preset pins it first", async () => {
    const pinned = Array.from({ length: 10 }, (_, i) => hex(i + 1));
    const { app, page } = await launch(pinned, []);
    try {
      await openPicker(page);
      await dragTo(page, swatch(page, "preset", "#ef4444ff"), await gapAfter(page, 3));
      await expect.poll(() => pinnedHexes(page)).toEqual([hex(1), hex(2), hex(3), "#ef4444ff", hex(4), hex(5), hex(6), hex(7), hex(8), hex(9)]);
      await swatch(page, "preset", "#3b82f6ff").press("Shift+Enter");
      await expect.poll(() => pinnedHexes(page)).toEqual(["#3b82f6ff", hex(1), hex(2), hex(3), "#ef4444ff", hex(4), hex(5), hex(6), hex(7), hex(8)]);
    } finally {
      await app.close();
    }
  });
});

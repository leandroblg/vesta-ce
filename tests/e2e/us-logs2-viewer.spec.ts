// 009 US2 — read my logs inside Vesta (US2-1 to US2-9; quickstart 3, 4, 5; FR-012 to FR-020; PRD Q123, Q127).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { advanceClock } from "./fixtures/clock";
import { exportFolder, exportVia, importVia } from "./fixtures/export";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { entriesFor, seedLogs } from "./fixtures/logs";
import { seedSetting } from "./fixtures/seed";
import { dialog, openSettings, setLanguage, showPane } from "./fixtures/settings";

const viewer = (page: Page) => page.getByRole("dialog", { name: "Logs" });
const list = (page: Page) => page.getByTestId("log-list");
const rows = (page: Page) => list(page).locator("li[data-key]");
const level = (page: Page) => page.getByTestId("log-level");

async function openViewer(page: Page): Promise<void> {
  await openSettings(page, "Data");
  await dialog(page).getByTestId("logs-open").click();
  await expect(viewer(page)).toBeVisible();
}

/** Settings → Updates → Check for updates; waits until the check ended. */
async function checkNow(page: Page): Promise<void> {
  if (!(await page.locator("dialog.settings-dialog[open]").first().isVisible())) await openSettings(page);
  await showPane(page, "Updates");
  await page.getByTestId("update-check").click();
  await expect(page.getByTestId("update-check")).toBeEnabled({ timeout: 20_000 });
}

/** The seq numbers of the rows drawn right now, top to bottom. */
const shownSeqs = async (page: Page) =>
  (await rows(page).locator(".lv-fields").allTextContents()).map((t) => Number(/seq=(\d+)/.exec(t)?.[1] ?? -1));

test.describe("009 US2 — the log viewer", () => {
  test("Settings has a Logs section with its button and the privacy note (US2-1)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      const section = dialog(page).locator("section", { has: page.getByRole("heading", { name: "Logs" }) });
      await expect(section.getByTestId("logs-open")).toBeVisible();
      await expect(section).toContainText("Logs never leave this computer unless you export them. At most 50 MiB, in 1 MiB files.");
    } finally {
      await app.close();
    }
  });

  test("opens on the newest entry, focused, and scrolling down reads every entry once, newest to oldest (US2-2, US2-3)", async () => {
    const dataDir = freshDataDir();
    const seeded = seedLogs(dataDir, { numbers: [998, 999, 1, 2], perFile: 400, levels: ["info"] });
    const { app, page } = await launchVesta({ dataDir });
    try {
      const started = Date.now();
      await openViewer(page);
      // Vesta's own start entries are newer than the seeded ones, so they come first.
      await expect(rows(page).filter({ hasText: "seed.entry" }).first()).toBeVisible();
      expect(Date.now() - started).toBeLessThan(5_000);
      await expect(list(page)).toBeFocused();
      // The newest seeded entry is the newest "seed.entry" (the app's own entries come after it).
      const firstSeed = (await shownSeqs(page)).find((n) => n >= 0);
      expect(firstSeed).toBe(seeded.length - 1);
      // Scroll to the end, page by page.
      const seen = new Set<number>();
      for (let i = 0; i < 200; i++) {
        for (const n of await shownSeqs(page)) if (n >= 0) seen.add(n);
        if (seen.has(0)) break;
        await list(page).evaluate((el) => {
          el.scrollTop += el.clientHeight * 0.8;
        });
        await page.waitForTimeout(60);
      }
      expect(seen.size).toBe(seeded.length);
    } finally {
      await app.close();
    }
  });

  test("the level filters the view at once and decides what Debug records; it is kept after a restart (US2-4 to US2-6)", async () => {
    const dataDir = freshDataDir();
    seedLogs(dataDir, { numbers: [1], perFile: 300, levels: ["info", "warn", "error", "debug"] });
    const first = await launchVesta({ dataDir });
    let run = first;
    try {
      await openViewer(run.page);
      await expect(level(run.page)).toHaveValue("info");
      await expect(rows(run.page).locator(".lv-level", { hasText: "Debug" })).toHaveCount(0);
      const t0 = Date.now();
      await level(run.page).selectOption("error");
      await expect(rows(run.page).locator(".lv-level", { hasText: /^Warn$|^Info$/ })).toHaveCount(0);
      expect(Date.now() - t0).toBeLessThan(2_000);
      await expect(rows(run.page).locator(".lv-level", { hasText: "Error" }).first()).toBeVisible();

      // Debug: earlier Debug entries show, and new ones are recorded from now on.
      await level(run.page).selectOption("debug");
      await expect(rows(run.page).locator(".lv-level", { hasText: "Debug" }).first()).toBeVisible();
      await run.page.keyboard.press("Escape");
      // A manual check logs update.check.start at Debug.
      const debugBefore = entriesFor(dataDir, "update.check.start").length;
      await advanceClock(run.app, 61_000); // past the one-request-a-minute limit (FR-022b)
      await checkNow(run.page);
      await expect.poll(() => entriesFor(dataDir, "update.check.start").length).toBe(debugBefore + 1);

      // Back to Info: a further Debug-producing action adds no Debug line.
      await showPane(run.page, "Data");
      await run.page.getByTestId("logs-open").click();
      await level(run.page).selectOption("info");
      await expect(level(run.page)).toHaveValue("info");
      const before = entriesFor(dataDir, "update.check.start").length;
      await run.page.keyboard.press("Escape");
      await advanceClock(run.app, 61_000);
      await checkNow(run.page);
      await expect.poll(() => entriesFor(dataDir, "update.check.failed").length + entriesFor(dataDir, "update.check.end").length).toBeGreaterThan(0);
      expect(entriesFor(dataDir, "update.check.start").length).toBe(before);

      await openViewer(run.page);
      await level(run.page).selectOption("trace");
      run = await relaunch(run);
      await openViewer(run.page);
      await expect(level(run.page)).toHaveValue("trace");
    } finally {
      await run.app.close();
    }
  });

  test("new entries appear on top while open (US2-7)", async () => {
    const dataDir = freshDataDir();
    seedSetting(dataDir, "logLevel", "trace");
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openViewer(page);
      await expect(rows(page).first()).toBeVisible();
      // Any IPC call writes an ipc.call Trace entry; reading the next page is one.
      await page.evaluate(() => window.vesta.logs.read({ cursor: null, level: "info" }));
      await expect(rows(page).first()).toContainText("ipc.call");
    } finally {
      await app.close();
    }
  });

  test("Esc closes the viewer only, focus back on the Logs button (US2-8, FR-020)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openViewer(page);
      await page.keyboard.press("Escape");
      await expect(viewer(page)).toBeHidden();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByTestId("logs-open")).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("an empty log at the selected level says so (US2-9)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openViewer(page);
      await level(page).selectOption("fatal");
      await expect(list(page)).toContainText("No log entries yet.");
    } finally {
      await app.close();
    }
  });

  test("times are local, marked with their offset (FR-016)", async () => {
    const dataDir = freshDataDir();
    seedLogs(dataDir, { numbers: [1], perFile: 1, levels: ["warn"], startMs: Date.UTC(2026, 9, 19, 20, 0, 3, 123) });
    const { app, page } = await launchVesta({ dataDir, env: { TZ: "America/Sao_Paulo" } });
    try {
      await openViewer(page);
      await expect(list(page).locator("li", { hasText: "seed.entry" }).locator("time")).toHaveText("2026-10-19 17:00:03.123 -3");
    } finally {
      await app.close();
    }
  });

  test("changing the language changes the viewer's labels, not the entries (spec edge case)", async () => {
    const dataDir = freshDataDir();
    seedLogs(dataDir, { numbers: [1], perFile: 3, levels: ["warn"] });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await setLanguage(page, "fr", "fr");
      await showPane(page, "Data");
      await page.getByTestId("logs-open").click();
      await expect(page.getByRole("dialog", { name: "Journaux" })).toBeVisible();
      await expect(rows(page).locator(".lv-level", { hasText: "Avertissement" }).first()).toBeVisible();
      await expect(rows(page).filter({ hasText: "seed.entry" }).first()).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("an imported log level applies to recording at once (T033)", async () => {
    const source = freshDataDir();
    seedSetting(source, "logLevel", "debug");
    const a = await launchVesta({ dataDir: source });
    const folder = exportFolder();
    try {
      await exportVia(a.app, a.page, folder);
    } finally {
      await a.app.close();
    }
    const zip = readdirSync(folder).find((f) => f.endsWith(".zip")) ?? "";
    const dataDir = freshDataDir();
    const b = await launchVesta({ dataDir });
    try {
      expect(await importVia(b.app, b.page, join(folder, zip))).toBe("merged");
      await advanceClock(b.app, 61_000); // past the one-request-a-minute limit after the check at start (FR-022b)
      await checkNow(b.page);
      await expect.poll(() => entriesFor(dataDir, "update.check.start").length, { timeout: 10_000 }).toBeGreaterThan(0);
    } finally {
      await b.app.close();
    }
  });
});

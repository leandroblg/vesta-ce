// 009 SC-005, FR-022, research §13 (checklist CHK005, CHK026; analysis M1, M2): Chromium's NetLog records every
// DNS lookup and connection from every process. Across the main flows of 001–009 none goes anywhere, the
// update check included (the fixture answers), and the real net.fetch path is blocked for any other address.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { exportFolder, exportVia, importVia } from "./fixtures/export";
import { launchVesta } from "./fixtures/launch";
import { entriesFor } from "./fixtures/logs";
import { readNetLog } from "../unit/fixtures/netlog";
import { launchWithNetLog, netLogHosts } from "./fixtures/netlog";
import { probeBlockedFetch, updateRequests } from "./fixtures/releases";
import { search } from "./fixtures/search";
import { freshDataDir } from "./fixtures/launch";
import { reminder, seedReminders, seedSetting, seedTasks, task } from "./fixtures/seed";
import { closeSettings, openSettings, setTheme, showPane } from "./fixtures/settings";

async function addTask(page: Page, title: string) {
  const editor = page.getByRole("textbox", { name: "New task…" });
  if (!(await editor.isVisible())) await page.getByRole("button", { name: "New task…" }).click();
  await editor.fill(title);
  await editor.press("Enter");
}

test.describe("009 SC-005 — nothing leaves the app but the allowed requests", () => {
  test("the main flows look up and connect to no host at all; blocked requests leave no trace", async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    seedTasks(dataDir, [
      task({ titleMd: "Report", detailsMd: "A remote image: ![chart](https://example.com/chart.png)\n\n[a link](https://example.com/page)" }),
      task({ titleMd: "Old", createdAt: Date.now() - 10 * 86_400_000, staleBaseAt: Date.now() - 10 * 86_400_000 }),
    ]);
    seedReminders(dataDir, [reminder({ textMd: "Call the bank" })]);
    const run = await launchWithNetLog({ dataDir });
    try {
      const { app, page } = run;
      // 001: capture, edit, done and undo.
      await addTask(page, "Buy milk");
      await taskCard(page, "Buy milk").getByRole("checkbox").click();
      await page.getByRole("button", { name: "Undo" }).click();
      // 005: the details panel with a remote image and a link (rendered, never loaded).
      await taskCard(page, "Report").locator(".title").click();
      await expect(page.locator("[data-md-placeholder='remote-image']").first()).toBeVisible();
      await page.keyboard.press("Escape");
      // 006: search.
      await search(page, "bank");
      await search(page, "");
      // 007: Settings changes.
      await openSettings(page, "General");
      await setTheme(page, "Dark");
      // 008: export and import.
      const folder = exportFolder();
      await exportVia(app, page, folder);
      const zip = readdirSync(folder).find((f) => f.endsWith(".zip")) ?? "";
      expect(await importVia(app, page, join(folder, zip))).toBe("merged");
      // 009: the log viewer and a manual update check (answered by the fixture).
      await openSettings(page, "Data");
      await page.getByTestId("logs-open").click();
      await page.keyboard.press("Escape");
      await showPane(page, "Updates");
      await page.getByTestId("update-check").click();
      await expect(page.getByTestId("update-check")).toBeEnabled();
      await closeSettings(page);
      expect((await updateRequests(app)).length).toBeGreaterThanOrEqual(1);

      // The real transport is guarded by the same allow-list (analysis M2); the probe refuses allowed addresses.
      expect(await probeBlockedFetch(app, "https://example.com/")).toBe(true);
      expect(await probeBlockedFetch(app, "https://api.github.com/users/x")).toBe(true);
      await expect(probeBlockedFetch(app, "https://api.github.com/repos/OWNER/vesta/releases")).rejects.toThrow();
      const blocked = entriesFor(dataDir, "network.blocked");
      expect(blocked).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ level: "warn", scheme: "https", host: "example.com" }),
          expect.objectContaining({ level: "warn", scheme: "https", host: "api.github.com" }),
        ]),
      );
      expect(blocked.every((e) => !("url" in e))).toBe(true);
    } finally {
      await run.app.close();
    }
    // The NetLog is complete once the app has quit.
    // A real, complete NetLog: Chromium wrote its final state at quit, and it holds network events.
    expect(readFileSync(run.netLog, "utf8")).toContain('"polledData"');
    expect(readNetLog(run.netLog).events.length).toBeGreaterThan(0);
    expect(netLogHosts(run.netLog)).toEqual([]);
  });

  test("with automatic checks off, no update request is made at all (SC-005)", async () => {
    const dataDir = freshDataDir();
    seedSetting(dataDir, "autoUpdateCheck", false);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await addTask(page, "Something");
      await page.waitForTimeout(1_000);
      expect(await updateRequests(app)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

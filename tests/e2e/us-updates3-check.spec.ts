// 009 US3 — know when a newer Vesta exists (Story 3 scenarios 1 to 13; quickstart 6 to 9; FR-021 to FR-028).
// Every request goes to the fixture transport (contracts/ipc.md "Test transport"); nothing contacts GitHub.
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { advanceClock } from "./fixtures/clock";
import { freshDataDir, launchVesta, relaunch, type Launched } from "./fixtures/launch";
import { entriesFor } from "./fixtures/logs";
import { answer, release, releasesFile, tickUpdates, updateRequests, useReleases, type ReleaseSource } from "./fixtures/releases";
import { seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const notice = (page: Page) => page.getByTestId("notification");
/** 013 FR-024: the mark is on the Updates tab and, on macOS, the Dock badge (the cogwheel is gone). */
const IS_MAC = process.platform === "darwin";
const dockBadge = (app: ElectronApplication) => app.evaluate(({ app: a }) => a.dock?.getBadge() ?? "");
const updatesMark = (page: Page) => page.getByTestId("updates-mark");
const status = (page: Page) => page.getByTestId("update-status");
const SYSTEM = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux";

/** A version `n` majors above the running one. */
async function newer(app: ElectronApplication, n = 1): Promise<string> {
  const v = await app.evaluate(({ app: a }) => a.getVersion());
  const [major] = v.split(".").map(Number);
  return `${String((major ?? 0) + n)}.0.0`;
}

async function launchWith(source: ReleaseSource | null, dataDir = freshDataDir()): Promise<Launched> {
  return launchVesta({ dataDir, env: source === null ? {} : { VESTA_TEST_RELEASES: releasesFile(source) } });
}

/** The check at start has run (one request recorded). */
const startChecked = (app: ElectronApplication) => expect.poll(async () => (await updateRequests(app)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

async function stubShell(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] };
    g.opened = [];
    shell.openExternal = (u: string) => {
      g.opened.push(u);
      return Promise.resolve();
    };
  });
}
const opened = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);

async function pressCheck(page: Page): Promise<void> {
  if (!(await page.locator("dialog.settings-dialog[open]").first().isVisible())) await openSettings(page, "Updates");
  await page.getByTestId("update-check").click();
  await expect(page.getByTestId("update-check")).toBeEnabled({ timeout: 20_000 });
}

test.describe("009 US3 — the update check", () => {
  test("a newer release at start: notice and mark; View opens Updates with notes and links; once per version (1, 4 to 8)", async () => {
    // The running version is only known once launched: start with an empty list, then announce.
    let run = await launchWith(null);
    const v = await newer(run.app);
    await run.app.close();
    const source = answer([release(v, { notes: `## What's new in ${v}\n\n- Faster start` })]);
    run = await launchWith(source, run.dataDir);
    try {
      await stubShell(run.app);
      await expect(notice(run.page)).toHaveAttribute("data-kind", "update", { timeout: 10_000 });
      await expect(notice(run.page)).toContainText(`Vesta ${v} is available.`);
      if (IS_MAC) await expect.poll(() => dockBadge(run.app)).toBe("1");

      await run.page.getByTestId("update-view").click();
      await expect(dialog(run.page)).toBeVisible();
      await expect(run.page.locator("#set-updates-h")).toBeFocused();
      await expect(status(run.page)).toHaveText(`Vesta ${v} is available.`);
      await expect(run.page.getByTestId("release-notes")).toContainText(`What's new in ${v}`);
      await expect(updatesMark(run.page)).toHaveCount(0);
      if (IS_MAC) await expect.poll(() => dockBadge(run.app)).toBe("");
      await run.page.getByTestId("update-download").click();
      await expect(run.page.getByTestId("update-download")).toHaveText(`Download for ${SYSTEM}`);
      await run.page.getByTestId("update-all").click();
      await expect.poll(() => opened(run.app)).toHaveLength(2);
      const [file, page] = await opened(run.app);
      expect(file).toMatch(new RegExp(`^https://github\\.com/OWNER/vesta/releases/download/v${v}/Vesta-${v}-`));
      expect(page).toBe(`https://github.com/OWNER/vesta/releases/tag/v${v}`);

      // Restart: the same version is not announced again.
      run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(source) } });
      await startChecked(run.app);
      await run.page.waitForTimeout(800);
      await expect(notice(run.page)).toHaveCount(0);
      if (IS_MAC) expect(await dockBadge(run.app)).toBe("");

      // A still newer version is announced again.
      const later = await newer(run.app, 2);
      run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(later)])) } });
      await expect(notice(run.page)).toContainText(`Vesta ${later} is available.`, { timeout: 10_000 });
    } finally {
      await run.app.close();
    }
  });

  test("the notice waits behind an undo notice and never replaces it (FR-024)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Mine" })]);
    let run = await launchWith(null, dataDir);
    const v = await newer(run.app);
    run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)], 1500)) } });
    try {
      await run.page.locator("li[data-kind='task']").filter({ hasText: "Mine" }).getByRole("checkbox").click();
      await expect(notice(run.page)).toHaveAttribute("data-kind", "done");
      await run.page.waitForTimeout(2_000);
      await expect(notice(run.page)).toHaveAttribute("data-kind", "done");
      await notice(run.page).getByRole("button", { name: "Close" }).click();
      await expect(notice(run.page)).toHaveAttribute("data-kind", "update");
    } finally {
      await run.app.close();
    }
  });

  test("found while Settings is open: shown there, no notice, no mark (spec edge case)", async () => {
    let run = await launchWith(null);
    const v = await newer(run.app);
    run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)], 1500)) } });
    try {
      await openSettings(run.page, "Updates");
      await expect(status(run.page)).toHaveText(`Vesta ${v} is available.`, { timeout: 10_000 });
      await closeSettings(run.page);
      await run.page.waitForTimeout(500);
      await expect(notice(run.page)).toHaveCount(0);
      await openSettings(run.page, "General");
      await expect(updatesMark(run.page)).toHaveCount(0);
      if (IS_MAC) expect(await dockBadge(run.app)).toBe("");
    } finally {
      await run.app.close();
    }
  });

  test("up to date: a manual check says so with its time; within a minute it makes no new request (9, FR-022b)", async () => {
    const { app, page } = await launchWith(null);
    try {
      await startChecked(app);
      await advanceClock(app, 61_000);
      await pressCheck(page);
      const v = await app.evaluate(({ app: a }) => a.getVersion());
      await expect(status(page)).toContainText(`Vesta ${v} is the latest version. Last checked`);
      const count = (await updateRequests(app)).length;
      await pressCheck(page);
      expect((await updateRequests(app)).length).toBe(count);
      await expect(status(page)).toContainText("is the latest version");
    } finally {
      await app.close();
    }
  });

  test("checks again 24 h after a success, and hourly after a failure, quietly (2, 10)", async () => {
    const { app, page, dataDir } = await launchWith(null);
    try {
      await startChecked(app);
      expect(await updateRequests(app)).toHaveLength(1);
      await advanceClock(app, DAY - 60_000);
      await tickUpdates(app);
      expect(await updateRequests(app)).toHaveLength(1);
      await advanceClock(app, 60_000);
      await useReleases(app, { fail: "offline" });
      await tickUpdates(app);
      expect(await updateRequests(app)).toHaveLength(2);
      await expect.poll(() => entriesFor(dataDir, "update.check.failed").length).toBe(1);
      expect(entriesFor(dataDir, "update.check.failed")[0]).toMatchObject({ level: "warn", reason: "offline" });
      await expect(notice(page)).toHaveCount(0);
      await advanceClock(app, HOUR);
      await tickUpdates(app);
      expect(await updateRequests(app)).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  test("automatic checks off: no request on its own; the button still checks; ticking checks at once (12, 13)", async () => {
    let run = await launchWith(null);
    try {
      await startChecked(run.app);
      await openSettings(run.page, "Updates");
      await expect(dialog(run.page)).toContainText(
        "Vesta asks GitHub Releases for the latest version at start and once a day. Nothing about you or your data is sent.",
      );
      await run.page.getByTestId("auto-update").click();
      await expect(run.page.getByTestId("auto-update")).not.toBeChecked();
      await expect(dialog(run.page)).toContainText(
        "Vesta asks GitHub Releases for the latest version only when you press Check for updates. Nothing about you or your data is sent.",
      );
      run = await relaunch(run);
      await run.page.waitForTimeout(1_000);
      expect(await updateRequests(run.app)).toHaveLength(0);
      await advanceClock(run.app, 2 * DAY);
      await tickUpdates(run.app);
      expect(await updateRequests(run.app)).toHaveLength(0);
      await pressCheck(run.page);
      expect(await updateRequests(run.app)).toHaveLength(1);
      await advanceClock(run.app, 61_000);
      await run.page.getByTestId("auto-update").click();
      await expect(run.page.getByTestId("auto-update")).toBeChecked();
      await expect.poll(async () => (await updateRequests(run.app)).length).toBe(2);
    } finally {
      await run.app.close();
    }
  });

  test("drafts and pre-releases are ignored; failures say 'could not check' after a manual press only (10, 11)", async () => {
    const { app, page, dataDir } = await launchWith(null);
    try {
      await startChecked(app);
      const v = await newer(app);
      const cases: [ReleaseSource, string][] = [
        [answer([release(v, { draft: true }), release(await newer(app, 2), { prerelease: true })]), "is the latest version"],
        [{ status: 403, body: { message: "rate limited" }, headers: { "x-ratelimit-remaining": "0" } }, "Vesta could not check for updates. Check your connection and try again."],
        [{ status: 200, body: "<html>not json</html>" }, "Vesta could not check for updates. Check your connection and try again."],
        [{ status: 200, body: [], redirect: "https://objects.githubusercontent.com/x" }, "Vesta could not check for updates. Check your connection and try again."],
      ];
      for (const [source, text] of cases) {
        await useReleases(app, source);
        await advanceClock(app, 61_000);
        await pressCheck(page);
        await expect(status(page)).toContainText(text);
      }
      await expect(notice(page)).toHaveCount(0);
      expect(entriesFor(dataDir, "update.check.failed").map((e) => e["reason"])).toEqual(["rateLimited", "unreadable", "redirect"]);
    } finally {
      await app.close();
    }
  });

  test("Settings closed during a manual check: the result shows when it is reopened (spec edge case)", async () => {
    const { app, page } = await launchWith(null);
    try {
      await startChecked(app);
      const v = await newer(app);
      await useReleases(app, answer([release(v)], 2000));
      await advanceClock(app, 61_000);
      await openSettings(page, "Updates");
      await page.getByTestId("update-check").click();
      await expect(status(page)).toHaveText("Checking GitHub Releases…");
      await closeSettings(page);
      await page.waitForTimeout(2_500);
      await openSettings(page, "Updates");
      await expect(status(page)).toHaveText(`Vesta ${v} is available.`);
    } finally {
      await app.close();
    }
  });
});

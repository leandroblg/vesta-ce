// 013 US4 (spec scenarios 1–6; quickstart row 7): Settings and updates without the cogwheel. Every request goes to
// the fixture transport (009 contracts/ipc.md "Test transport").
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { advanceClock } from "./fixtures/clock";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { clickMenu } from "./fixtures/menu";
import { answer, release, releasesFile, tickUpdates, updateRequests } from "./fixtures/releases";
import { IS_MAC, MOD, closeSettings, dialog, openSettings, showPane } from "./fixtures/settings";

const notice = (page: Page) => page.getByTestId("notification");
const updatesTab = (page: Page) => page.locator('dialog.settings-dialog[open] [role="tab"][data-pane="updates"]');
const updatesMark = (page: Page) => page.getByTestId("updates-mark");
const dockBadge = (app: ElectronApplication) => app.evaluate(({ app: a }) => a.dock?.getBadge() ?? "");

async function newer(app: ElectronApplication): Promise<string> {
  const v = await app.evaluate(({ app: a }) => a.getVersion());
  const [major] = v.split(".");
  return `${String(Number(major) + 1)}.0.0`;
}

test.describe("013 US4 — Settings and updates without the cogwheel", () => {
  test("US4-1 US4-2 the toolbar has no Settings button; Mod+, and Settings… open the last pane shown", async () => {
    const { app, page } = await launchVesta();
    try {
      await expect(page.locator("header button.cog, header #settings-cog")).toHaveCount(0);
      await expect(page.locator("header").getByRole("button", { name: /^Settings/ })).toHaveCount(0);
      await openSettings(page, "Alerts");
      await closeSettings(page);
      await page.keyboard.press(`${MOD}+Comma`);
      await expect(dialog(page).locator('[role="tab"][aria-selected="true"]')).toHaveAttribute("data-pane", "alerts");
      await closeSettings(page);
      await clickMenu(app, "settings");
      await expect(dialog(page).locator('[role="tab"][aria-selected="true"]')).toHaveAttribute("data-pane", "alerts");
    } finally {
      await app.close();
    }
  });

  test("US4-3 US4-4 a newer version marks the Updates tab and the Dock; another pane keeps them; the Updates pane clears them for good", async () => {
    let run = await launchVesta({ dataDir: freshDataDir() });
    const v = await newer(run.app);
    run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)])) } });
    try {
      await expect(notice(run.page)).toHaveAttribute("data-kind", "update", { timeout: 10_000 });
      if (IS_MAC) await expect.poll(() => dockBadge(run.app)).toBe("1");
      await openSettings(run.page, "General");
      await expect(updatesMark(run.page)).toBeVisible();
      await expect(updatesTab(run.page)).toHaveAccessibleName("Updates, update available");
      await showPane(run.page, "Alerts");
      await expect(updatesMark(run.page)).toBeVisible();
      if (IS_MAC) expect(await dockBadge(run.app)).toBe("1");
      await showPane(run.page, "Updates");
      await expect(updatesMark(run.page)).toHaveCount(0);
      if (IS_MAC) await expect.poll(() => dockBadge(run.app)).toBe("");
      await closeSettings(run.page);
      await tickUpdates(run.app);
      await openSettings(run.page, "General");
      await expect(updatesMark(run.page)).toHaveCount(0);
      if (IS_MAC) expect(await dockBadge(run.app)).toBe("");
    } finally {
      await run.app.close();
    }
  });

  test("US4-5 Check for Updates… opens Updates and checks, also with automatic checks off", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Updates");
      const auto = dialog(page).getByRole("checkbox", { name: "Check for updates automatically" });
      if (await auto.isChecked()) await auto.click();
      await expect(auto).not.toBeChecked();
      await closeSettings(page);
      // 009 FR-022b: a check within a minute of the last makes no request, so the test clock moves past it.
      await advanceClock(app, 2 * 60_000);
      const before = (await updateRequests(app)).length;
      await clickMenu(app, "checkUpdates");
      await expect(updatesTab(page)).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => (await updateRequests(app)).length).toBe(before + 1);
    } finally {
      await app.close();
    }
  });

  test("T114 FR-024 a version found while the Updates pane is shown is seen at once: no notice, no tab mark, no Dock badge", async () => {
    let run = await launchVesta({ dataDir: freshDataDir() });
    const v = await newer(run.app);
    await openSettings(run.page, "Updates");
    const auto = dialog(run.page).getByRole("checkbox", { name: "Check for updates automatically" });
    if (await auto.isChecked()) await auto.click();
    await closeSettings(run.page);
    run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)])) } });
    try {
      await advanceClock(run.app, 2 * 60_000);
      const before = (await updateRequests(run.app)).length;
      await clickMenu(run.app, "checkUpdates");
      await expect(updatesTab(run.page)).toHaveAttribute("aria-selected", "true");
      await expect.poll(async () => (await updateRequests(run.app)).length).toBe(before + 1);
      await expect(dialog(run.page)).toContainText(v);
      await expect(updatesMark(run.page)).toHaveCount(0);
      await expect(notice(run.page)).toHaveCount(0);
      if (IS_MAC) expect(await dockBadge(run.app)).toBe("");
      await showPane(run.page, "General");
      await expect(updatesMark(run.page)).toHaveCount(0);
    } finally {
      await run.app.close();
    }
  });

  test("US4-6 selecting the update notice opens Settings at Updates", async () => {
    let run = await launchVesta({ dataDir: freshDataDir() });
    const v = await newer(run.app);
    run = await relaunch(run, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)])) } });
    try {
      await expect(notice(run.page)).toHaveAttribute("data-kind", "update", { timeout: 10_000 });
      await run.page.getByTestId("update-view").click();
      await expect(updatesTab(run.page)).toHaveAttribute("aria-selected", "true");
      await expect(updatesMark(run.page)).toHaveCount(0);
    } finally {
      await run.app.close();
    }
  });
});

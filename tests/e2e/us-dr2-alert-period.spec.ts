// 012 US2: a longer alert period lifts a stale mark that no longer applies; typed periods apply after 500 ms
// (quickstart scenarios 3 and 4, tasks T031 to T033).
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { blinkLog, recordBlinks, taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, minimize, readTask, restoreWindow, tick, tickCount } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, staleTask, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";
import { backToTasks } from "./fixtures/nav";

const overridePanel = (page: Page) => page.getByRole("dialog", { name: "Alert override" });
const ovField = (page: Page, name: "Days" | "Hours" | "Minutes") => overridePanel(page).getByRole("spinbutton", { name });
const useGlobal = (page: Page) => overridePanel(page).getByRole("checkbox", { name: /Use the global default/ });
const setField = (page: Page, setting: string, unit: "Days" | "Hours" | "Minutes") =>
  dialog(page).getByRole("group", { name: setting }).getByRole("spinbutton", { name: unit });
const blinksOn = async (page: Page, id: string) => (await blinkLog(page)).filter((b) => b.id === id).map((b) => b.blinks);
const titles = (page: Page) => page.locator("li[data-kind='task'] .title").allTextContents();

/** The alert settings as main holds them. */
function stored(page: Page, key: "alertPeriodMin" | "reblinkIntervalMin" | "rescheduleToleranceMin"): Promise<number | null> {
  return page.evaluate(async (k) => {
    const r = await window.vesta.app.getInitialState();
    return r.ok ? r.value.alertSettings[k] : null;
  }, key);
}

async function openOverride(page: Page, title: string) {
  const card = taskCard(page, title);
  await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
  await page.getByRole("menuitem", { name: "Alert Period…" }).click();
  await expect(overridePanel(page)).toBeVisible();
}

async function at(app: ElectronApplication, page: Page, ms: number) {
  await waitBlinksDone(page);
  await advanceClock(app, ms);
  await tick(page);
}

function expectNotStale(page: Page, title: string) {
  const card = taskCard(page, title);
  return Promise.all([
    expect(card).not.toHaveClass(/\bstale\b/),
    expect(card.locator(".age")).toHaveCount(0),
    expect(card.getByRole("button", { name: "Reschedule" })).toHaveCount(0),
  ]);
}

test.describe("012 US2 — a change of the alert period", () => {
  test("FR-026 FR-027 FR-029 a 7-day override un-stales, the task leaves the group, then goes stale again with 3 blinks", async () => {
    const dataDir = freshDataDir();
    const late = staleTask({ titleMd: "Late", position: 5 });
    seedTasks(dataDir, [late, task({ titleMd: "Fresh", position: 1 }), task({ titleMd: "Fresher", position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await expect(taskCard(page, "Late")).toHaveClass(/\bstale\b/);
      expect(await titles(page)).toEqual(["Late", "Fresh", "Fresher"]);
      await openOverride(page, "Late");
      await useGlobal(page).uncheck();
      await ovField(page, "Days").fill("7");
      await expect.poll(() => readTask(dataDir, late.id)?.stale_since ?? null).toBeNull();
      await page.keyboard.press("Escape");
      await expectNotStale(page, "Late");
      // Top of the non-stale tasks (FR-029); the stale history stays (FR-030).
      expect(await titles(page)).toEqual(["Late", "Fresh", "Fresher"]);
      expect(readTask(dataDir, late.id)?.was_stale).toBe(1);

      await recordBlinks(page);
      await at(app, page, 5 * DAY - HOUR);
      await expectNotStale(page, "Late");
      await at(app, page, 2 * HOUR);
      await expect(taskCard(page, "Late")).toHaveClass(/\bstale\b/);
      await expect.poll(() => blinksOn(page, late.id)).toEqual([3]);
      await expect(taskCard(page, "Late").locator(".age .v")).toHaveText(/^7d/);
    } finally {
      await app.close();
    }
  });

  test("FR-026 a 30 h override at 2 days keeps it stale with no blink; a rescheduled task is unchanged", async () => {
    const dataDir = freshDataDir();
    const late = staleTask({ titleMd: "Still late" });
    const resched = staleTask({ titleMd: "Rescheduled", staleBaseAt: Date.now() - 2 * DAY + HOUR });
    seedTasks(dataDir, [late, resched]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await recordBlinks(page);
      await openOverride(page, "Still late");
      await useGlobal(page).uncheck();
      await ovField(page, "Days").fill("1");
      await ovField(page, "Hours").fill("6");
      await expect.poll(() => readTask(dataDir, late.id)?.alert_period_override_min).toBe(30 * 60);
      await page.keyboard.press("Escape");
      await tick(page);
      await expect(taskCard(page, "Still late")).toHaveClass(/\bstale\b/);
      expect(await blinksOn(page, late.id)).toEqual([]);

      await openOverride(page, "Rescheduled");
      await useGlobal(page).uncheck();
      await ovField(page, "Days").fill("30");
      await expect.poll(() => readTask(dataDir, resched.id)?.alert_period_override_min).toBe(30 * 1440);
      await page.keyboard.press("Escape");
      await expect(taskCard(page, "Rescheduled")).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("FR-026 the same through Settings → Default alert period; tasks with an override are untouched", async () => {
    const dataDir = freshDataDir();
    const plain = staleTask({ titleMd: "Global" });
    const own = staleTask({ titleMd: "Own period", alertOverrideMin: 1440 });
    seedTasks(dataDir, [plain, own]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await openSettings(page, "Alerts");
      await setField(page, "Default alert period", "Days").fill("7");
      await expect.poll(() => readTask(dataDir, plain.id)?.stale_since ?? null).toBeNull();
      await closeSettings(page);
      await expectNotStale(page, "Global");
      await expect(taskCard(page, "Own period")).toHaveClass(/\bstale\b/);
      expect(readTask(dataDir, plain.id)?.updated_at).toBe(plain.updatedAt);
    } finally {
      await app.close();
    }
  });

  test("A4 rule 9: a hidden subtask's marker goes, and its parent blinks once when it goes stale again", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent", collapsed: true, alertOverrideMin: 30 * 1440 });
    const sub = staleTask({ titleMd: "Sub", parentId: parent.id });
    seedTasks(dataDir, [parent, sub]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await expect(taskCard(page, "Parent").locator(".stale-sub")).toHaveText("Stale subtask");
      await openSettings(page, "Alerts");
      await setField(page, "Default alert period", "Days").fill("7");
      await expect.poll(() => readTask(dataDir, sub.id)?.stale_since ?? null).toBeNull();
      await closeSettings(page);
      await expect(taskCard(page, "Parent").locator(".stale-sub")).toHaveCount(0);
      await recordBlinks(page);
      await at(app, page, 5 * DAY + MIN);
      await expect.poll(() => blinksOn(page, parent.id)).toEqual([1]);
      await expect(taskCard(page, "Parent").locator(".stale-sub")).toHaveText("Stale subtask");
    } finally {
      await app.close();
    }
  });

  test("FR-027 A4 rule 6: going stale again while minimized blinks once on return; reduced motion shows the outline", async () => {
    const dataDir = freshDataDir();
    const late = staleTask({ titleMd: "Away" });
    seedTasks(dataDir, [late]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await openSettings(page, "Alerts");
      await setField(page, "Default alert period", "Days").fill("7");
      await expect.poll(() => readTask(dataDir, late.id)?.stale_since ?? null).toBeNull();
      await closeSettings(page);
      await recordBlinks(page);
      await minimize(app);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);
      await at(app, page, 5 * DAY + MIN);
      expect(await blinksOn(page, late.id)).toEqual([]);
      const before = await tickCount(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await restoreWindow(app);
      await page.waitForFunction((n) => Number(document.documentElement.dataset["alertTicks"]) > n, before);
      await expect.poll(() => blinksOn(page, late.id)).toEqual([1]);
      const card = taskCard(page, "Away");
      expect(await card.evaluate((el) => el.getAnimations().length)).toBe(0);
      await expect(card).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("FR-028 FR-030 a done stale task restored after a longer period comes back not stale; once done again it shows the stale tag", async () => {
    const dataDir = freshDataDir();
    const done = staleTask({ titleMd: "Archived", doneAt: Date.now() - HOUR });
    seedTasks(dataDir, [done, task({ titleMd: "Other" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await openSettings(page, "Alerts");
      await setField(page, "Default alert period", "Days").fill("7");
      await expect.poll(() => stored(page, "alertPeriodMin")).toBe(7 * 1440);
      await closeSettings(page);
      // The done task kept its mark while done.
      expect(readTask(dataDir, done.id)?.stale_since).not.toBeNull();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator(".arow").filter({ hasText: "Archived" }).getByRole("button", { name: "Restore" }).click();
      await backToTasks(page);
      await expect.poll(() => readTask(dataDir, done.id)?.stale_since ?? null).toBeNull();
      await expectNotStale(page, "Archived");
      await taskCard(page, "Archived").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await expect(page.locator(".arow").filter({ hasText: "Archived" }).locator(".gtag")).toContainText("Stale");
    } finally {
      await app.close();
    }
  });

  test("FR-026a typing 1 then 10 days applies once with no blink; closing applies a pending value; re-blink debounced; tolerance at once", async () => {
    const dataDir = freshDataDir();
    const late = staleTask({ titleMd: "Typing" });
    seedTasks(dataDir, [late]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await openOverride(page, "Typing");
      await useGlobal(page).uncheck();
      await expect.poll(() => readTask(dataDir, late.id)?.alert_period_override_min).toBe(1440);
      await recordBlinks(page);
      await ovField(page, "Days").fill("10");
      await expect.poll(() => readTask(dataDir, late.id)?.alert_period_override_min).toBe(10 * 1440);
      expect(readTask(dataDir, late.id)?.stale_since).toBeNull();
      await ovField(page, "Days").fill("1");
      await ovField(page, "Days").fill("12");
      await expect.poll(() => readTask(dataDir, late.id)?.alert_period_override_min).toBe(12 * 1440);
      await tick(page);
      expect(await blinksOn(page, late.id)).toEqual([]);
      // T077: ticking Use global default within 500 ms of typing wins; the typed value never applies.
      await ovField(page, "Days").fill("15");
      await useGlobal(page).check();
      await page.waitForTimeout(800);
      expect(readTask(dataDir, late.id)?.alert_period_override_min ?? null).toBeNull();
      await useGlobal(page).uncheck();
      await expect.poll(() => readTask(dataDir, late.id)?.alert_period_override_min).toBe(1440);
      // Closing 100 ms after typing saves the value at once.
      await ovField(page, "Days").fill("20");
      await page.waitForTimeout(100);
      await page.keyboard.press("Escape");
      await expect.poll(() => readTask(dataDir, late.id)?.alert_period_override_min).toBe(20 * 1440);

      await openSettings(page, "Alerts");
      // U1: closing Settings 100 ms after typing an alert period saves it.
      await setField(page, "Default alert period", "Days").fill("3");
      await page.waitForTimeout(100);
      await closeSettings(page);
      await expect.poll(() => stored(page, "alertPeriodMin")).toBe(3 * 1440);
      await openSettings(page, "Alerts");
      // G5, 018 Q288: the re-blink interval saves once, 2 s after the last keystroke.
      const reblink = setField(page, "Re-blink interval", "Hours");
      await reblink.fill("5");
      expect(await stored(page, "reblinkIntervalMin")).toBe(240);
      await expect.poll(() => stored(page, "reblinkIntervalMin")).toBe(300);
      // 018 Q288, Q289: the reschedule tolerance follows the group rule; Enter saves it at once.
      await setField(page, "Reschedule tolerance", "Hours").fill("2");
      expect(await stored(page, "rescheduleToleranceMin")).toBe(1440);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      expect(await stored(page, "rescheduleToleranceMin")).toBe(1440 + 120);
    } finally {
      await app.close();
    }
  });
});

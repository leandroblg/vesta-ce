/** 003 User Story 4: the Alert override panel (T052). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta, relaunch, type Launched } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { backToTasks } from "./fixtures/nav";

const panel = (page: Page) => page.getByRole("dialog", { name: "Alert override" });
const field = (page: Page, name: "Days" | "Hours" | "Minutes") => panel(page).getByRole("spinbutton", { name });
const useGlobal = (page: Page) => panel(page).getByRole("checkbox", { name: /Use the global default \(1d\)/ });

async function openPanel(page: Page, title: string) {
  const card = taskCard(page, title);
  await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
  await page.getByRole("menuitem", { name: "Alert Period…" }).click();
  await expect(panel(page)).toBeVisible();
}

async function launch(titles: string[]) {
  const dataDir = freshDataDir();
  const rows = titles.map((titleMd, i) => task({ titleMd, position: i + 1 }));
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  return { ...launched, ids: Object.fromEntries(rows.map((r) => [r.titleMd, r.id])) };
}

test.describe("003 US4 — Alert override", () => {
  test("opens in place of the menu with the global default ticked; untick stores it; edits apply at once; invalid input is refused (scenarios 1–6)", async () => {
    const { app, page, dataDir, ids } = await launch(["Plan the trip", "Other"]);
    const id = ids["Plan the trip"] ?? "";
    try {
      const card = taskCard(page, "Plan the trip");
      await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
      const menuBox = await page.getByRole("menu").boundingBox();
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      await expect(page.getByRole("menu")).toHaveCount(0);
      const box = await panel(page).boundingBox();
      expect(Math.abs((box?.y ?? 0) - (menuBox?.y ?? 0))).toBeLessThan(40);
      await expect(useGlobal(page)).toBeFocused();
      await expect(panel(page)).toContainText("Alert period for this task");

      await expect(useGlobal(page)).toBeChecked();
      await expect(field(page, "Days")).toBeDisabled();
      await expect(field(page, "Days")).toHaveValue("1");
      await expect(field(page, "Hours")).toHaveValue("0");
      expect(readTask(dataDir, id)?.alert_period_override_min).toBeNull();

      await useGlobal(page).uncheck();
      await expect(field(page, "Days")).toBeEnabled();
      await expect.poll(() => readTask(dataDir, id)?.alert_period_override_min).toBe(1440);

      await field(page, "Days").fill("7");
      await expect.poll(() => readTask(dataDir, id)?.alert_period_override_min).toBe(7 * 1440);

      await field(page, "Days").fill("0");
      await expect(panel(page)).toContainText("The minimum is 1 hour.");
      await field(page, "Minutes").fill("30");
      await expect(panel(page)).toContainText("The minimum is 1 hour.");
      expect(readTask(dataDir, id)?.alert_period_override_min).toBe(7 * 1440);
      // 016 FR-031 (PRD Q237): 24 hours becomes 23 at once, with no error.
      await field(page, "Hours").fill("24");
      await expect(field(page, "Hours")).toHaveValue("23");
      await expect(panel(page)).not.toContainText("Allowed range");
      await expect.poll(() => readTask(dataDir, id)?.alert_period_override_min).toBe(23 * 60 + 30);
      await field(page, "Hours").fill("2");
      await expect(panel(page)).not.toContainText("Allowed range");
      await expect.poll(() => readTask(dataDir, id)?.alert_period_override_min).toBe(150);

      await useGlobal(page).check();
      await expect.poll(() => readTask(dataDir, id)?.alert_period_override_min ?? null).toBeNull();
      await expect(field(page, "Days")).toHaveValue("1");
    } finally {
      await app.close();
    }
  });

  test("Esc closes and returns focus to the menu button; a click outside closes; another row's menu closes it (scenario 7, FR-038)", async () => {
    const { app, page } = await launch(["One", "Two"]);
    try {
      await openPanel(page, "One");
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);
      await expect(taskCard(page, "One").getByRole("button", { name: "More actions" })).toBeFocused();

      await openPanel(page, "One");
      await page.mouse.click(5, 5);
      await expect(panel(page)).toHaveCount(0);

      // The panel overlays the rows below its own, so the other row is the one above.
      await openPanel(page, "Two");
      await clickRevealed(taskCard(page, "One"), taskCard(page, "One").getByRole("button", { name: "More actions" }));
      await expect(panel(page)).toHaveCount(0);
      await expect(page.getByRole("menu")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("a task that leaves the list while its panel is open does not reopen the panel when it comes back (spec edge case, FR-034)", async () => {
    const { app, page } = await launch(["Leaving", "Staying"]);
    try {
      await openPanel(page, "Leaving");
      // A synthetic click marks it done without a pointer press, which would close the panel first.
      await taskCard(page, "Leaving").getByRole("checkbox", { name: "Mark done: Leaving" }).dispatchEvent("click");
      await expect(taskCard(page, "Leaving")).toHaveCount(0);
      await expect(panel(page)).toHaveCount(0);
      await page.getByTestId("notification").getByRole("button", { name: "Undo" }).dispatchEvent("click");
      await expect(taskCard(page, "Leaving")).toBeVisible();
      await expect(panel(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("an invalid value is discarded on close, keeping the last valid override", async () => {
    const { app, page, dataDir, ids } = await launch(["Discard"]);
    try {
      await openPanel(page, "Discard");
      await useGlobal(page).uncheck();
      await field(page, "Days").fill("3");
      await expect.poll(() => readTask(dataDir, ids["Discard"] ?? "")?.alert_period_override_min).toBe(3 * 1440);
      await field(page, "Days").fill("0");
      await page.keyboard.press("Escape");
      await openPanel(page, "Discard");
      await expect(field(page, "Days")).toHaveValue("3");
      expect(readTask(dataDir, ids["Discard"] ?? "")?.alert_period_override_min).toBe(3 * 1440);
    } finally {
      await app.close();
    }
  });

  test("7 days: not stale at 6 d 23 h, stale just after 7 d; the override survives done, restore and a relaunch (scenarios 8–10)", async () => {
    const first = await launch(["Seven"]);
    const id = first.ids["Seven"] ?? "";
    let run: Launched = first;
    try {
      await openPanel(run.page, "Seven");
      await useGlobal(run.page).uncheck();
      await field(run.page, "Days").fill("7");
      await expect.poll(() => readTask(run.dataDir, id)?.alert_period_override_min).toBe(7 * 1440);
      await run.page.keyboard.press("Escape");

      await advanceClock(run.app, 7 * DAY - HOUR);
      await tick(run.page);
      await expect(taskCard(run.page, "Seven")).not.toHaveClass(/\bstale\b/);
      await advanceClock(run.app, HOUR + MIN);
      await tick(run.page);
      await expect(taskCard(run.page, "Seven")).toHaveClass(/\bstale\b/);

      await taskCard(run.page, "Seven").getByRole("checkbox").click();
      await run.page.getByRole("button", { name: /^Archive/ }).click();
      await run.page.getByRole("button", { name: "Restore: Seven" }).click();
      await backToTasks(run.page);
      run = await relaunch(run);
      expect(readTask(run.dataDir, id)?.alert_period_override_min).toBe(7 * 1440);
    } finally {
      await run.app.close();
    }
  });

  test("a 30 h-old task: a 2-day override keeps it fresh, 1 day makes it stale at once (scenario 8, FR-009)", async () => {
    const dataDir = freshDataDir();
    const row = task({ titleMd: "Thirty", createdAt: Date.now() - 30 * HOUR, alertOverrideMin: 2880 });
    seedTasks(dataDir, [row]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await expect(taskCard(page, "Thirty")).not.toHaveClass(/\bstale\b/);
      await openPanel(page, "Thirty");
      await field(page, "Days").fill("1");
      await expect(taskCard(page, "Thirty")).toHaveClass(/\bstale\b/);
      await expect(taskCard(page, "Thirty")).toHaveClass(/\bblink\b/);
    } finally {
      await app.close();
    }
  });
});

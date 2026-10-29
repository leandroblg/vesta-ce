/** 003 FR-046, SC-004: alerts by keyboard alone, and no accessibility violations in either theme (T067). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { expectNoA11yViolations } from "./fixtures/axe";
import { clickRevealed } from "./fixtures/hover";
import { DAY, HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const ago = (ms: number) => Date.now() - ms;

async function launch() {
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Collapsed parent", position: 3, collapsed: true, alertOverrideMin: 30 * 1440 });
  const rows = [
    task({ titleMd: "Old task", position: 1, createdAt: ago(30 * HOUR) }),
    task({ titleMd: "Fresh task", position: 2 }),
    parent,
    task({ titleMd: "Hidden sub", parentId: parent.id, position: 1 }),
    task({ titleMd: "Archived stale", position: 4, createdAt: ago(3 * DAY), doneAt: ago(HOUR), wasStale: true }),
  ];
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  await waitBlinksDone(launched.page);
  return { ...launched, ids: Object.fromEntries(rows.map((r) => [r.titleMd, r.id])) };
}

const menuButton = (page: Page, title: string) => taskCard(page, title).getByRole("button", { name: "More actions" });

test("003 FR-046: Reschedule and the Alert override panel work with the keyboard alone", async () => {
  const { app, page, dataDir, ids } = await launch();
  try {
    await taskCard(page, "Old task").getByRole("checkbox").focus();
    await page.keyboard.press("Tab");
    await expect(taskCard(page, "Old task").getByRole("button", { name: "Reschedule" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(taskCard(page, "Old task")).not.toHaveClass(/\bstale\b/);

    await menuButton(page, "Fresh task").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    // 015 FR-001: New Subtask, Show Details, Reschedule and Postpone For come before Alert Period… on every active task.
    for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Alert Period…" })).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Alert override" });
    await expect(dialog.getByRole("checkbox")).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => readTask(dataDir, ids["Fresh task"] ?? "")?.alert_period_override_min).toBe(1440);
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("spinbutton", { name: "Days" })).toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("3");
    await expect.poll(() => readTask(dataDir, ids["Fresh task"] ?? "")?.alert_period_override_min).toBe(3 * 1440);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(menuButton(page, "Fresh task")).toBeFocused();
  } finally {
    await app.close();
  }
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`003 SC-004: stale rows, a blinking row, the marker, the override panel and the Archive tag pass the scan in ${colorScheme} mode`, async () => {
    test.setTimeout(90_000);
    const { app, page } = await launch();
    try {
      await page.emulateMedia({ colorScheme });
      await expect(taskCard(page, "Old task")).toHaveClass(/\bstale\b/);
      await expectNoA11yViolations(page, `${colorScheme}: stale row`);

      await advanceClock(app, DAY + MIN);
      await tick(page);
      await expect(taskCard(page, "Collapsed parent")).toHaveClass(/\bblink\b/);
      await expect(taskCard(page, "Collapsed parent").locator(".stale-sub")).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: collapsed parent signalling, marker`);

      await waitBlinksDone(page);
      await taskCard(page, "Collapsed parent").getByRole("button", { name: "Expand" }).click();
      await expectNoA11yViolations(page, `${colorScheme}: marker on an expanded parent`);

      await clickRevealed(taskCard(page, "Fresh task"), menuButton(page, "Fresh task"));
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      const dialog = page.getByRole("dialog", { name: "Alert override" });
      await dialog.getByRole("checkbox").click();
      // 016 FR-031: an over-maximum value is clamped, so the error shown is the minimum's.
      await dialog.getByRole("spinbutton", { name: "Days" }).fill("0");
      await dialog.getByRole("spinbutton", { name: "Hours" }).fill("0");
      await dialog.getByRole("spinbutton", { name: "Minutes" }).fill("0");
      await expect(dialog).toContainText("The minimum is 1 hour.");
      await expectNoA11yViolations(page, `${colorScheme}: override panel with an error`);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /^Archive/ }).click();
      await expect(page.locator(".gtag")).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: Archive stale tag`);
    } finally {
      await app.close();
    }
  });
}

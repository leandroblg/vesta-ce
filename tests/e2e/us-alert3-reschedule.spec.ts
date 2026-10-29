/** 003 User Story 3: Reschedule from the hover button or the menu (T047). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const topTitles = (page: Page) => page.locator("li[data-kind='task']:not(.sub) .title");
const ago = (ms: number) => Date.now() - ms;

async function launch(rows: ReturnType<typeof task>[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  await waitBlinksDone(launched.page);
  return launched;
}

test.describe("003 US3 — Reschedule", () => {
  test("hover and focus show Reschedule left of Edit on stale rows only; the menu offers it in order, also on a fresh row (scenarios 1–3; 015 Q203)", async () => {
    const p = task({ titleMd: "Old parent", position: 2, createdAt: ago(30 * HOUR) });
    const { app, page } = await launch([
      task({ titleMd: "Fresh", position: 1, createdAt: ago(HOUR) }),
      p,
      task({ titleMd: "Old sub", parentId: p.id, position: 1, createdAt: ago(30 * HOUR) }),
    ]);
    try {
      const old = taskCard(page, "Old parent");
      await old.hover();
      const buttons = old.locator(".actions button");
      await expect(buttons).toHaveCount(3);
      await expect(buttons.nth(0)).toHaveAccessibleName("Reschedule");
      await expect(buttons.nth(1)).toHaveAccessibleName("Edit");
      await expect(buttons.nth(2)).toHaveAccessibleName("More actions");

      await taskCard(page, "Fresh").getByRole("checkbox").focus();
      await expect(taskCard(page, "Fresh").getByRole("button", { name: "Reschedule" })).toHaveCount(0);
      await clickRevealed(taskCard(page, "Fresh"), taskCard(page, "Fresh").getByRole("button", { name: "More actions" }));
      await expect(page.getByRole("menuitem", { name: "Reschedule", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");

      await old.getByRole("checkbox").focus();
      await expect(old.getByRole("button", { name: "Reschedule" })).toBeVisible();
      await clickRevealed(old, old.getByRole("button", { name: "More actions" }));
      await expect(page.getByRole("menuitem")).toHaveText(["New Subtask", "Show Details", "Reschedule", "Postpone For", "Alert Period…", "Move to Trash"]);
      await page.keyboard.press("Escape");

      const sub = taskCard(page, "Old sub");
      await clickRevealed(sub, sub.getByRole("button", { name: "More actions" }));
      await expect(page.getByRole("menuitem")).toHaveText(["Show Details", "Reschedule", "Postpone For", "Alert Period…", "Move to Trash"]);
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("Reschedule clears the stale state at once and moves the task to the top of the non-stale tasks; it stays after a relaunch (scenarios 4–5)", async () => {
    let run = await launch([
      task({ titleMd: "A", position: 1, createdAt: ago(HOUR) }),
      task({ titleMd: "B", position: 2, createdAt: ago(HOUR) }),
      task({ titleMd: "Older", position: 3, createdAt: ago(40 * HOUR) }),
      task({ titleMd: "Old", position: 4, createdAt: ago(30 * HOUR) }),
    ]);
    try {
      await expect(topTitles(run.page)).toHaveText(["Older", "Old", "A", "B"]);
      const old = taskCard(run.page, "Old");
      await clickRevealed(old, old.getByRole("button", { name: "Reschedule" }));
      await expect(old).not.toHaveClass(/\bstale\b/);
      await expect(old.locator(".age")).toHaveCount(0);
      await expect(topTitles(run.page)).toHaveText(["Older", "Old", "A", "B"]);
      await expect(taskCard(run.page, "Older")).toHaveClass(/\bstale\b/);

      const older = taskCard(run.page, "Older");
      await clickRevealed(older, older.getByRole("button", { name: "More actions" }));
      await run.page.getByRole("menuitem", { name: "Reschedule" }).click();
      await expect(topTitles(run.page)).toHaveText(["Older", "Old", "A", "B"]);
      await expect(older).not.toHaveClass(/\bstale\b/);

      run = await relaunch(run);
      await expect(topTitles(run.page)).toHaveText(["Older", "Old", "A", "B"]);
    } finally {
      await run.app.close();
    }
  });

  test("a rescheduled subtask stays in its place under its parent (scenario 7)", async () => {
    const p = task({ titleMd: "Parent", position: 1, createdAt: ago(HOUR) });
    const { app, page } = await launch([
      p,
      task({ titleMd: "First", parentId: p.id, position: 1, createdAt: ago(HOUR) }),
      task({ titleMd: "Stale sub", parentId: p.id, position: 2, createdAt: ago(30 * HOUR) }),
    ]);
    try {
      const sub = taskCard(page, "Stale sub");
      await clickRevealed(sub, sub.getByRole("button", { name: "Reschedule" }));
      await expect(sub).not.toHaveClass(/\bstale\b/);
      await expect(page.locator("li[data-kind='task'] .title")).toHaveText(["Parent", "First", "Stale sub"]);
    } finally {
      await app.close();
    }
  });

  test("goes stale again after the tolerance, age counted from creation; 016 Q228: the reschedule now offers Undo (scenario 8, FR-033)", async () => {
    const old = task({ titleMd: "Again", position: 1, createdAt: ago(30 * HOUR) });
    const { app, page, dataDir } = await launch([old, task({ titleMd: "Other", position: 2, createdAt: ago(HOUR) })]);
    try {
      await taskCard(page, "Other").getByRole("checkbox").click();
      await expect(page.getByTestId("notification")).toContainText(/moved to the Archive\./);
      const card = taskCard(page, "Again");
      await clickRevealed(card, card.getByRole("button", { name: "Reschedule" }));
      await expect(card).not.toHaveClass(/\bstale\b/);
      // 016 FR-001 (Q228): every reschedule shows its own notice with Undo, replacing the Archive one.
      await expect(page.getByTestId("notification")).toContainText("“Again” rescheduled.");
      expect(readTask(dataDir, old.id)).toMatchObject({ stale_since: null, was_stale: 1 });

      await advanceClock(app, DAY - MIN);
      await tick(page);
      await expect(card).not.toHaveClass(/\bstale\b/);
      await advanceClock(app, 2 * MIN);
      await tick(page);
      await expect(card).toHaveClass(/\bstale\b/);
      await expect(card.locator(".age .v")).toHaveText("2d 6h");
    } finally {
      await app.close();
    }
  });
});

/** 003 User Story 2: stale top-level tasks rise to the top, oldest first; sticky; restore exception (T041). */
import { expect, test, type Page } from "@playwright/test";
import { blinkLog, recordBlinks, taskCard } from "./fixtures/alerts";
import { HOUR, tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { backToTasks } from "./fixtures/nav";

const topTitles = (page: Page) => page.locator("li[data-kind='task']:not(.sub) .title");
const allTitles = (page: Page) => page.locator("li[data-kind='task'] .title");
const ago = (ms: number) => Date.now() - ms;

async function launch(rows: ReturnType<typeof task>[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  return launched;
}

test.describe("003 US2 — old tasks rise to the top", () => {
  test("stale tasks first, oldest first, carrying their subtasks; others in saved order (scenarios 1–3)", async () => {
    const b = task({ titleMd: "B report", position: 2, createdAt: ago(30 * HOUR) });
    const { app, page } = await launch([
      task({ titleMd: "A fresh", position: 1, createdAt: ago(HOUR) }),
      b,
      task({ titleMd: "B1 numbers", parentId: b.id, position: 1, createdAt: ago(HOUR) }),
      task({ titleMd: "B2 summary", parentId: b.id, position: 2, createdAt: ago(40 * HOUR) }),
      task({ titleMd: "C passport", position: 3, createdAt: ago(40 * HOUR) }),
      task({ titleMd: "D bike", position: 4, createdAt: ago(2 * HOUR) }),
    ]);
    try {
      await expect(topTitles(page)).toHaveText(["C passport", "B report", "A fresh", "D bike"]);
      await expect(allTitles(page)).toHaveText(["C passport", "B report", "B1 numbers", "B2 summary", "A fresh", "D bike"]);
      await expect(taskCard(page, "B2 summary")).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("a stale task stays stale through done and undo, and through done and restore (scenarios 4–5)", async () => {
    const { app, page } = await launch([
      task({ titleMd: "Fresh", position: 1, createdAt: ago(HOUR) }),
      task({ titleMd: "Old", position: 2, createdAt: ago(30 * HOUR) }),
    ]);
    try {
      await expect(topTitles(page)).toHaveText(["Old", "Fresh"]);
      await taskCard(page, "Old").getByRole("checkbox").click();
      await page.getByTestId("notification").getByRole("button", { name: "Undo" }).click();
      await expect(topTitles(page)).toHaveText(["Old", "Fresh"]);
      await expect(taskCard(page, "Old")).toHaveClass(/\bstale\b/);

      await taskCard(page, "Old").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.getByRole("button", { name: "Restore: Old" }).click();
      await backToTasks(page);
      await expect(topTitles(page)).toHaveText(["Old", "Fresh"]);
      await expect(taskCard(page, "Old")).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("a subtask goes stale on its own, with its own override; the parent stays (scenario 6)", async () => {
    const p = task({ titleMd: "Parent", position: 1, createdAt: ago(13 * HOUR) });
    const { app, page } = await launch([p, task({ titleMd: "Child", parentId: p.id, position: 1, createdAt: ago(3 * HOUR), alertOverrideMin: 120 })]);
    try {
      await expect(taskCard(page, "Child")).toHaveClass(/\bstale\b/);
      await expect(taskCard(page, "Parent")).not.toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("restore exception: a task whose period passed in the Archive comes back stale and blinks 3 times", async () => {
    const done = task({ titleMd: "Archived", position: 2, createdAt: ago(72 * HOUR), doneAt: ago(70 * HOUR) });
    const { app, page } = await launch([task({ titleMd: "Fresh", position: 1, createdAt: ago(HOUR) }), done]);
    try {
      await recordBlinks(page);
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.getByRole("button", { name: "Restore: Archived" }).click();
      await backToTasks(page);
      await expect(topTitles(page)).toHaveText(["Archived", "Fresh"]);
      await expect(taskCard(page, "Archived")).toHaveClass(/\bstale\b/);
      await expect.poll(async () => (await blinkLog(page)).filter((b) => b.id === done.id).map((b) => b.blinks)).toEqual([3]);
    } finally {
      await app.close();
    }
  });
});

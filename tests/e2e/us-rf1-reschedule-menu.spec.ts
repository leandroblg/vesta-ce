/** 015 User Story 1: Reschedule any active task, stale or not (FR-001 to FR-005, PRD Q203; ui.md "Card context menu"). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { waitMenuState } from "./fixtures/menu";
import { search } from "./fixtures/search";
import { seedTasks, task } from "./fixtures/seed";

const ago = (ms: number) => Date.now() - ms;

async function launch(rows: ReturnType<typeof task>[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  await waitBlinksDone(launched.page);
  return { ...launched, dataDir };
}

async function openMenu(page: Page, title: string) {
  const card = taskCard(page, title);
  await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
}

test.describe("015 US1 — Reschedule any active task", () => {
  test("a task and a subtask that are not stale list Reschedule, also while searching; no hover button (scenarios 1, 5)", async () => {
    const parent = task({ titleMd: "Fresh parent", position: 1, createdAt: ago(HOUR) });
    const { app, page } = await launch([parent, task({ titleMd: "Fresh sub", parentId: parent.id, position: 1, createdAt: ago(HOUR) })]);
    try {
      for (const title of ["Fresh parent", "Fresh sub"]) {
        await openMenu(page, title);
        await expect(page.getByRole("menuitem", { name: "Reschedule", exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      const card = taskCard(page, "Fresh parent");
      await card.hover();
      await expect(card.getByRole("button", { name: "Reschedule" })).toHaveCount(0);

      await search(page, "Fresh");
      await openMenu(page, "Fresh parent");
      await expect(page.getByRole("menuitem", { name: "Reschedule", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("Reschedule on a task that is not stale: stale one tolerance later, not at its first period; no Stale pill once done (scenarios 2, 3)", async () => {
    const { app, page, dataDir } = await launch([task({ titleMd: "Almost stale", position: 1, createdAt: ago(23 * HOUR) })]);
    try {
      await openMenu(page, "Almost stale");
      await page.getByRole("menuitem", { name: "Reschedule", exact: true }).click();
      const card = taskCard(page, "Almost stale");
      const id = (await card.getAttribute("data-id")) ?? "";
      await expect.poll(() => readTask(dataDir, id)?.was_stale).toBe(0);

      await advanceClock(app, 2 * HOUR);
      await tick(page);
      await expect(card).not.toHaveClass(/\bstale\b/);
      await advanceClock(app, DAY - 2 * HOUR - MIN);
      await tick(page);
      await expect(card).not.toHaveClass(/\bstale\b/);
      await advanceClock(app, 2 * MIN);
      await tick(page);
      await expect(card).toHaveClass(/\bstale\b/);
      expect(readTask(dataDir, id)?.was_stale).toBe(1);
    } finally {
      await app.close();
    }
  });

  test("a task rescheduled before going stale and marked done shows no Stale pill in the Archive (scenario 3)", async () => {
    const { app, page } = await launch([task({ titleMd: "Never stale", position: 1, createdAt: ago(HOUR) })]);
    try {
      await openMenu(page, "Never stale");
      await page.getByRole("menuitem", { name: "Reschedule", exact: true }).click();
      await taskCard(page, "Never stale").getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      const row = page.locator("li.arow", { hasText: "Never stale" });
      await expect(row).toBeVisible();
      await expect(row.locator(".gtag")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("a stale task rescheduled from the menu clears its stale mark and keeps its Stale pill once done (scenario 4)", async () => {
    const { app, page } = await launch([task({ titleMd: "Old", position: 1, createdAt: ago(30 * HOUR) })]);
    try {
      const card = taskCard(page, "Old");
      await expect(card).toHaveClass(/\bstale\b/);
      await openMenu(page, "Old");
      await page.getByRole("menuitem", { name: "Reschedule", exact: true }).click();
      await expect(card).not.toHaveClass(/\bstale\b/);
      await card.getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await expect(page.locator("li.arow", { hasText: "Old" }).locator(".gtag")).toContainText("Stale");
    } finally {
      await app.close();
    }
  });

  test("Edit › Reschedule is enabled for a subtask that is not stale (scenario 6)", async () => {
    const parent = task({ titleMd: "Parent", position: 1, createdAt: ago(HOUR) });
    const { app, page } = await launch([parent, task({ titleMd: "Child", parentId: parent.id, position: 1, createdAt: ago(HOUR) })]);
    try {
      await waitMenuState(app, "reschedule", { enabled: false });
      await taskCard(page, "Child").locator('[data-ctl="cb"]').focus();
      await waitMenuState(app, "reschedule", { enabled: true });
    } finally {
      await app.close();
    }
  });
});

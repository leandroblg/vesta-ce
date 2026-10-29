/** 003 User Story 6: subtasks going stale and collapsed parents (T060). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { blinkLog, recordBlinks, taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { backToTasks } from "./fixtures/nav";

const marker = (page: Page, title: string) => taskCard(page, title).locator(".stale-sub");
const blinksOn = async (page: Page, id: string) => (await blinkLog(page)).filter((b) => b.id === id).map((b) => b.blinks);

async function at(app: ElectronApplication, page: Page, ms: number) {
  await waitBlinksDone(page);
  await advanceClock(app, ms);
  await tick(page);
}

/** A parent created now (fresh for days) with subtasks created now; `collapsed` as given. */
async function launchFamily(collapsed: boolean, subs = ["Sub one"]) {
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Parent", position: 1, collapsed, alertOverrideMin: 30 * 1440 });
  const children = subs.map((titleMd, i) => task({ titleMd, parentId: parent.id, position: i + 1 }));
  seedTasks(dataDir, [parent, ...children]);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  return { ...launched, parent, children };
}

test.describe("003 US6 — subtasks going stale", () => {
  test("collapsed: the parent blinks once with the marker, once more after the interval; the subtask blinks once on expand (scenarios 1–3)", async () => {
    const { app, page, parent, children } = await launchFamily(true);
    const sub = children[0];
    try {
      await recordBlinks(page);
      await at(app, page, DAY + MIN);
      expect(await blinksOn(page, parent.id)).toEqual([1]);
      expect(await blinksOn(page, sub?.id ?? "")).toEqual([]);
      await expect(taskCard(page, "Parent")).not.toHaveClass(/\bstale\b/);
      await expect(marker(page, "Parent")).toHaveText("Stale subtask");
      await expect(taskCard(page, "Parent").locator(".title")).toHaveText("Parent");

      await at(app, page, 4 * HOUR);
      expect(await blinksOn(page, parent.id)).toEqual([1, 1]);

      await waitBlinksDone(page);
      await taskCard(page, "Parent").getByRole("button", { name: "Expand" }).click();
      await expect.poll(() => blinksOn(page, sub?.id ?? "")).toEqual([1]);
      await expect(taskCard(page, "Sub one")).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("expanded: the subtask blinks 3 times, the parent never blinks for it; the marker shows (scenarios 4–5)", async () => {
    const { app, page, parent, children } = await launchFamily(false);
    const sub = children[0];
    try {
      await recordBlinks(page);
      await at(app, page, DAY + MIN);
      expect(await blinksOn(page, sub?.id ?? "")).toEqual([3]);
      expect(await blinksOn(page, parent.id)).toEqual([]);
      await expect(marker(page, "Parent")).toBeVisible();
      await at(app, page, 4 * HOUR);
      expect(await blinksOn(page, sub?.id ?? "")).toEqual([3, 3]);
      expect(await blinksOn(page, parent.id)).toEqual([]);

      const card = taskCard(page, "Sub one");
      await clickRevealed(card, card.getByRole("button", { name: "Reschedule" }));
      await expect(marker(page, "Parent")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("the marker leaves when the only stale subtask is marked done or deleted (scenario 5)", async () => {
    const { app, page } = await launchFamily(false, ["Done one", "Deleted one"]);
    try {
      await at(app, page, DAY + MIN);
      await expect(marker(page, "Parent")).toBeVisible();
      await taskCard(page, "Done one").getByRole("checkbox").click();
      await expect(marker(page, "Parent")).toBeVisible();
      const del = taskCard(page, "Deleted one");
      await clickRevealed(del, del.getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await expect(marker(page, "Parent")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("restoring a collapsed parent with a stale subtask brings it back expanded; the subtask blinks 3 times, the parent does not (scenario 6)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const parent = task({ titleMd: "Archived parent", position: 1, collapsed: true, createdAt: now - HOUR, doneAt: now - 30 * MIN });
    const sub = task({ titleMd: "Old sub", parentId: parent.id, position: 1, createdAt: now - 2 * DAY, doneAt: now - 30 * MIN, leftWithId: parent.id });
    seedTasks(dataDir, [parent, sub]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await recordBlinks(page);
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.getByRole("button", { name: "Restore: Archived parent" }).click();
      await backToTasks(page);
      await expect(taskCard(page, "Archived parent").getByRole("button", { name: "Collapse" })).toBeVisible();
      await expect.poll(() => blinksOn(page, sub.id)).toEqual([3]);
      expect(await blinksOn(page, parent.id)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("two hidden subtasks in one tick give one parent blink (scenario 7)", async () => {
    const { app, page, parent } = await launchFamily(true, ["A", "B"]);
    try {
      await recordBlinks(page);
      await at(app, page, DAY + MIN);
      expect(await blinksOn(page, parent.id)).toEqual([1]);
    } finally {
      await app.close();
    }
  });

  test("a stale collapsed parent shows its own state and the marker; when its own re-blink falls in the same tick, only its own plays (scenario 7)", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent", position: 1, collapsed: true, createdAt: Date.now() - 30 * HOUR });
    seedTasks(dataDir, [parent, task({ titleMd: "A", parentId: parent.id, position: 1 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await recordBlinks(page);
      // Its own re-blink (4 h after its first blink) and the subtask going stale fall in this tick.
      await at(app, page, DAY + MIN);
      expect(await blinksOn(page, parent.id)).toEqual([3]);
      await expect(taskCard(page, "Parent")).toHaveClass(/\bstale\b/);
      await expect(taskCard(page, "Parent").locator(".age")).toBeVisible();
      await expect(marker(page, "Parent")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("reduced motion: nothing animates; the collapsed parent gets the outline and keeps its normal background (scenario 8)", async () => {
    const { app, page } = await launchFamily(true);
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const card = taskCard(page, "Parent");
      const normal = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
      await at(app, page, DAY + MIN);
      await expect(card).toHaveClass(/\bblink\b/);
      expect(await card.evaluate((el) => el.getAnimations().length)).toBe(0);
      expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
      expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(normal);
    } finally {
      await app.close();
    }
  });
});

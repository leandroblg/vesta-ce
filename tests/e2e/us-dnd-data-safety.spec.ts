/** 004 SC-003 (quickstart 24): a move is saved at once; a force-quit 500 ms later loses nothing (as 001 SC-004). */
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readReminders, readTitles } from "./fixtures/drag";

const remCard = (page: Page, text: string) =>
  page.locator("li[data-kind='rem']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });

test("20 force-quit trials: level-changing drops, keyboard moves and reminder moves survive a kill 500 ms later", async () => {
  test.setTimeout(300_000);
  const dataDir = freshDataDir();
  const p = task({ titleMd: "P", position: 1 });
  const x = task({ titleMd: "X", position: 2 });
  seedTasks(dataDir, [p, task({ titleMd: "P1", parentId: p.id, position: 1 }), x, task({ titleMd: "X1", parentId: x.id, position: 1 }), task({ titleMd: "T", position: 3 })]);
  seedReminders(dataDir, [reminder({ textMd: "R1", position: 1 }), reminder({ textMd: "R2", position: 2 })]);
  let expected: { tasks: string[]; reminders: string[] } | null = null;

  for (let trial = 1; trial <= 20; trial++) {
    const { app, page } = await launchVesta({ dataDir });
    if (expected !== null) {
      await expect.poll(() => readTitles(page)).toEqual(expected.tasks);
      expect(await readReminders(page)).toEqual(expected.reminders);
    }
    const kind = trial % 3;
    if (kind === 1) {
      // A demotion with a carried subtask, or the promotion back.
      const demoted = (await readTitles(page)).includes("  X");
      if (demoted) await dragTo(page, taskCard(page, "X"), { row: taskCard(page, "T"), zone: "upper" });
      else await dragTo(page, taskCard(page, "X"), { row: taskCard(page, "P"), zone: "middle" });
      await expect.poll(async () => (await readTitles(page)).includes("  X")).toBe(!demoted);
    } else if (kind === 2) {
      const before = await readTitles(page);
      await taskCard(page, "T").getByRole("checkbox").focus();
      await page.keyboard.press(before[0] === "T" ? "Alt+ArrowDown" : "Alt+ArrowUp");
      await expect.poll(() => readTitles(page)).not.toEqual(before);
    } else {
      const before = await readReminders(page);
      await remCard(page, before[1] ?? "").getByRole("checkbox").focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect.poll(() => readReminders(page)).toEqual([before[1], before[0]]);
    }
    expected = { tasks: await readTitles(page), reminders: await readReminders(page) };
    await page.waitForTimeout(500);
    app.process().kill("SIGKILL");
  }
  const { app, page } = await launchVesta({ dataDir });
  try {
    await expect.poll(() => readTitles(page)).toEqual(expected?.tasks);
    expect(await readReminders(page)).toEqual(expected?.reminders);
  } finally {
    await app.close();
  }
});

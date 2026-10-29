/**
 * 004 quickstart scenario 22: the runbook's card 004 step L list, automated (no hand check, per the
 * project's rule). The "1,000 tasks smooth" item is the SC-004 test in performance.spec.ts.
 */
import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, staleTask, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readMark, readTitles } from "./fixtures/drag";

test("runbook card 004 step L: drop rows with the indent shown, demotion with subtasks, a dragged stale task, Alt+Up / Alt+Down", async () => {
  const dataDir = freshDataDir();
  const now = Date.now();
  const p = task({ titleMd: "P", position: 1, alertOverrideMin: 14_400 });
  const x = task({ titleMd: "X", position: 2, alertOverrideMin: 14_400 });
  seedTasks(dataDir, [
    p,
    task({ titleMd: "S1", parentId: p.id, position: 1, alertOverrideMin: 14_400 }),
    x,
    task({ titleMd: "X1", parentId: x.id, position: 1, alertOverrideMin: 14_400 }),
    task({ titleMd: "T", position: 3, alertOverrideMin: 14_400 }),
    staleTask({ titleMd: "Old", createdAt: now - 3 * 86_400_000, position: 9 }),
  ]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await expect.poll(() => readTitles(page)).toEqual(["Old", "P", "  S1", "X", "  X1", "T"]);
    // Each Drop rules row shows its indent before release.
    expect(await dragTo(page, taskCard(page, "T"), { row: taskCard(page, "S1"), zone: "upper" }, { release: false })).toBe("line-sub");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await dragTo(page, taskCard(page, "T"), { row: taskCard(page, "S1"), zone: "lower" }, { release: false })).toBe("line-sub");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await dragTo(page, taskCard(page, "T"), { row: taskCard(page, "X"), zone: "upper" }, { release: false })).toBe("line-top");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await dragTo(page, taskCard(page, "T"), { row: taskCard(page, "P"), zone: "middle" }, { release: false })).toBe("card");
    await page.keyboard.press("Escape");
    await page.mouse.up();

    // Demoting a task with subtasks brings them along as siblings.
    expect(await dragTo(page, taskCard(page, "X"), { row: taskCard(page, "P"), zone: "middle" })).toBe("card");
    await expect.poll(() => readTitles(page)).toEqual(["Old", "P", "  S1", "  X", "  X1", "T"]);

    // A dragged stale task stays where dropped and stays stale.
    expect(await dragTo(page, taskCard(page, "Old"), { row: taskCard(page, "T"), zone: "lower" })).toBe("line-top");
    await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  X", "  X1", "T", "Old"]);
    await expect(taskCard(page, "Old")).toHaveClass(/stale/);
    expect(readMark(dataDir, "Old")).toBe(1);

    // Alt+Up / Alt+Down move the selected item.
    await taskCard(page, "T").getByRole("checkbox").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(() => readTitles(page)).toEqual(["T", "P", "  S1", "  X", "  X1", "Old"]);
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  X", "  X1", "T", "Old"]);
  } finally {
    await app.close();
  }
});

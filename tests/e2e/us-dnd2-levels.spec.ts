/** US2 — promote, demote and move between parents (004 quickstart scenarios 6–9; FR-006 to FR-011a). */
import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { DAY, seedTasks, task } from "./fixtures/seed";
import { blinkLog, recordBlinks, taskCard } from "./fixtures/alerts";
import { dragTo, readTitles, readUpdatedAt } from "./fixtures/drag";

/** P with S1, S2; Q; lone T. */
function rowsPQT() {
  const p = task({ titleMd: "P", position: 1 });
  return [
    p,
    task({ titleMd: "S1", parentId: p.id, position: 1 }),
    task({ titleMd: "S2", parentId: p.id, position: 2 }),
    task({ titleMd: "Q", position: 2 }),
    task({ titleMd: "T", position: 3 }),
    task({ titleMd: "M", position: 4 }),
  ];
}

async function setup(rows = rowsPQT()) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  return launchVesta({ dataDir });
}

test.describe("US2 — promote, demote and move between parents", () => {
  test("one drop per Drop rules row gives the stated result, with the indicator before release (scenario 6)", async () => {
    const { app, page } = await setup();
    try {
      // Row 1: above S1 (the lower part of the expanded parent P).
      expect(await dragTo(page, taskCard(page, "M"), { row: taskCard(page, "P"), zone: "lower" })).toBe("line-sub");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  M", "  S1", "  S2", "Q", "T"]);
      // Row 1: between S1 and S2.
      expect(await dragTo(page, taskCard(page, "M"), { row: taskCard(page, "S2"), zone: "upper" })).toBe("line-sub");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  M", "  S2", "Q", "T"]);
      // Row 2: upper part of the gap S2 → Q: the last subtask of P.
      expect(await dragTo(page, taskCard(page, "T"), { row: taskCard(page, "S2"), zone: "lower" })).toBe("line-sub");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  M", "  S2", "  T", "Q"]);
      // Row 3: lower part of that gap: a top-level task between P and Q.
      expect(await dragTo(page, taskCard(page, "T"), { row: taskCard(page, "Q"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  M", "  S2", "T", "Q"]);
      // Row 4: between two top-level tasks (T and Q), a subtask promoted.
      expect(await dragTo(page, taskCard(page, "M"), { row: taskCard(page, "T"), zone: "lower" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  S2", "T", "M", "Q"]);
      // Row 5: onto the middle of T (no subtasks): its first subtask.
      expect(await dragTo(page, taskCard(page, "M"), { row: taskCard(page, "T"), zone: "middle" })).toBe("card");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  S2", "T", "  M", "Q"]);
      // Row 5: onto the middle of P (with subtasks): its last subtask.
      expect(await dragTo(page, taskCard(page, "Q"), { row: taskCard(page, "P"), zone: "middle" })).toBe("card");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  S2", "  Q", "T", "  M"]);
      // Row 6: onto the middle of S1: right after S1.
      expect(await dragTo(page, taskCard(page, "M"), { row: taskCard(page, "S1"), zone: "middle" })).toBe("line-sub");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  M", "  S2", "  Q", "T"]);
    } finally {
      await app.close();
    }
  });

  test("a task with subtasks dropped among P's subtasks brings them along as siblings (scenario 7)", async () => {
    const p = task({ titleMd: "P", position: 1 });
    const x = task({ titleMd: "X", position: 2 });
    const { app, page } = await setup([
      p,
      task({ titleMd: "S1", parentId: p.id, position: 1 }),
      task({ titleMd: "S2", parentId: p.id, position: 2 }),
      x,
      task({ titleMd: "X1", parentId: x.id, position: 1 }),
      task({ titleMd: "X2", parentId: x.id, position: 2 }),
    ]);
    try {
      expect(await dragTo(page, taskCard(page, "X"), { row: taskCard(page, "S2"), zone: "upper" })).toBe("line-sub");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  X", "  X1", "  X2", "  S2"]);
    } finally {
      await app.close();
    }
  });

  test("a drop onto a collapsed parent makes the item its last subtask and expands it, also after a restart (scenario 8)", async () => {
    const q = task({ titleMd: "Q", position: 1, collapsed: true });
    const launched = await setup([q, task({ titleMd: "Q1", parentId: q.id, position: 1 }), task({ titleMd: "A", position: 2 })]);
    let current = launched;
    try {
      await expect.poll(() => readTitles(launched.page)).toEqual(["Q", "A"]);
      expect(await dragTo(launched.page, taskCard(launched.page, "A"), { row: taskCard(launched.page, "Q"), zone: "middle" })).toBe("card");
      await expect.poll(() => readTitles(launched.page)).toEqual(["Q", "  Q1", "  A"]);
      current = await relaunch(launched);
      await expect.poll(() => readTitles(current.page)).toEqual(["Q", "  Q1", "  A"]);
    } finally {
      await current.app.close();
    }
  });

  test("a parent over its own subtasks shows no indicator and saves nothing (scenario 9)", async () => {
    const { app, page, dataDir } = await setup();
    try {
      const before = readUpdatedAt(dataDir, "P");
      for (const [row, zone] of [["S1", "upper"], ["S1", "middle"], ["S2", "lower"], ["P", "middle"], ["P", "lower"]] as const) {
        expect(await dragTo(page, taskCard(page, "P"), { row: taskCard(page, row), zone })).toBeNull();
      }
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  S2", "Q", "T", "M"]);
      expect(readUpdatedAt(dataDir, "P")).toBe(before);
    } finally {
      await app.close();
    }
  });

  test("FR-011: the stale-subtask marker and the collapse toggle follow the move", async () => {
    const now = Date.now();
    const p = task({ titleMd: "P", position: 1 });
    const q = task({ titleMd: "Q", position: 2 });
    const { app, page } = await setup([
      p,
      task({ titleMd: "Old", parentId: p.id, position: 1, createdAt: now - 2 * DAY, staleSince: now - DAY, wasStale: true, firstBlinkCount: 1, lastBlinkAt: now }),
      q,
      task({ titleMd: "Q1", parentId: q.id, position: 1 }),
    ]);
    try {
      await expect(taskCard(page, "P").locator(".stale-sub")).toHaveCount(1);
      await dragTo(page, taskCard(page, "Old"), { row: taskCard(page, "Q"), zone: "middle" });
      await expect.poll(() => readTitles(page)).toEqual(["P", "Q", "  Q1", "  Old"]);
      await expect(taskCard(page, "P").locator(".stale-sub")).toHaveCount(0);
      await expect(taskCard(page, "Q").locator(".stale-sub")).toHaveCount(1);
      await expect(taskCard(page, "P").locator(".twisty")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("FR-011a: a hidden stale subtask that a demotion brings into view blinks once", async () => {
    const now = Date.now();
    const p = task({ titleMd: "P", position: 1 });
    const x = task({ titleMd: "X", position: 2, collapsed: true });
    const { app, page } = await setup([
      p,
      task({ titleMd: "P1", parentId: p.id, position: 1 }),
      x,
      task({ titleMd: "Hidden", parentId: x.id, position: 1, createdAt: now - 2 * DAY, staleSince: now - DAY, wasStale: true, firstBlinkCount: 1, lastBlinkAt: null, lastSignalAt: now }),
    ]);
    try {
      await expect.poll(() => readTitles(page)).toEqual(["P", "  P1", "X"]);
      await recordBlinks(page);
      expect(await dragTo(page, taskCard(page, "X"), { row: taskCard(page, "P"), zone: "middle" })).toBe("card");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  P1", "  X", "  Hidden"]);
      const hiddenId = await taskCard(page, "Hidden").getAttribute("data-id");
      await expect.poll(async () => (await blinkLog(page)).filter((b) => b.id === hiddenId)).toEqual([{ id: hiddenId, blinks: 1 }]);
    } finally {
      await app.close();
    }
  });
});

/** US3 — manual order wins over age sorting; the stale group stays on top (004 quickstart 10–14; FR-012 to FR-016, SC-002). */
import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { DAY, seedTasks, staleTask, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { HOUR, MIN, advanceClock, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { dragTo, readIndicator, readMark, readOrder, readTitles } from "./fixtures/drag";

/** A 10-day alert period keeps a task from going stale while the clock moves a day or two. */
const LONG = 14_400;

async function setup(rows: ReturnType<typeof task>[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  return launchVesta({ dataDir });
}

const groupTitles = async (page: Parameters<typeof readOrder>[0]) => (await readOrder(page)).filter((r) => r.inGroup).map((r) => r.title);

test.describe("US3 — manual order wins over age sorting", () => {
  test("a stale task dragged out of the group stays where dropped, stale and marked, across restart, Reschedule and going stale again (scenario 10)", async () => {
    const now = Date.now();
    const launched = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 3 * DAY, position: 10 }),
      staleTask({ titleMd: "G2", createdAt: now - 2 * DAY, position: 11 }),
      task({ titleMd: "A", position: 1, alertOverrideMin: LONG }),
      task({ titleMd: "B", position: 2, alertOverrideMin: LONG }),
    ]);
    let current = launched;
    try {
      const { page, dataDir } = launched;
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "A", "B"]);
      expect(await dragTo(page, taskCard(page, "G2"), { row: taskCard(page, "A"), zone: "lower" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["G1", "A", "G2", "B"]);
      await expect(taskCard(page, "G2")).toHaveClass(/stale/);
      await expect(taskCard(page, "G2").locator(".age")).toContainText("Stale");
      expect(readMark(dataDir, "G2")).toBe(1);

      current = await relaunch(launched);
      await expect.poll(() => readTitles(current.page)).toEqual(["G1", "A", "G2", "B"]);
      await clickRevealed(taskCard(current.page, "G2"), taskCard(current.page, "G2").getByRole("button", { name: "Reschedule" }));
      await expect(taskCard(current.page, "G2")).not.toHaveClass(/stale/);
      await expect.poll(() => readTitles(current.page)).toEqual(["G1", "A", "G2", "B"]);
      await advanceClock(current.app, DAY + 2 * MIN);
      await tick(current.page);
      await expect(taskCard(current.page, "G2")).toHaveClass(/stale/);
      await expect.poll(() => readTitles(current.page)).toEqual(["G1", "A", "G2", "B"]);
    } finally {
      await current.app.close();
    }
  });

  test("a non-stale task dropped above or inside the group lands just below it, never above it (scenario 11)", async () => {
    const now = Date.now();
    const { app, page } = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 4 * DAY, position: 10 }),
      staleTask({ titleMd: "G2", createdAt: now - 3 * DAY, position: 11 }),
      staleTask({ titleMd: "G3", createdAt: now - 2 * DAY, position: 12 }),
      task({ titleMd: "M1", position: 1 }),
      task({ titleMd: "M2", position: 2 }),
    ]);
    try {
      expect(await dragTo(page, taskCard(page, "M2"), { row: taskCard(page, "G1"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "G3", "M2", "M1"]);
      expect(await dragTo(page, taskCard(page, "M1"), { row: taskCard(page, "G3"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "G3", "M1", "M2"]);
    } finally {
      await app.close();
    }
  });

  test("with the group empty, F can go first; a task going stale later appears above F (scenario 12)", async () => {
    const now = Date.now();
    const { app, page } = await setup([
      task({ titleMd: "A", position: 1 }),
      task({ titleMd: "F", position: 2 }),
      task({ titleMd: "Late", position: 3, createdAt: now - 23 * HOUR }),
    ]);
    try {
      expect(await dragTo(page, taskCard(page, "F"), { row: taskCard(page, "A"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["F", "A", "Late"]);
      await advanceClock(app, 2 * HOUR);
      await tick(page);
      await expect.poll(() => readTitles(page)).toEqual(["Late", "F", "A"]);
      expect(await groupTitles(page)).toEqual(["Late"]);
    } finally {
      await app.close();
    }
  });

  test("a positioned-by-hand stale task and a stale subtask dropped in the group's area rejoin it, unmarked (scenario 13)", async () => {
    const now = Date.now();
    const p = task({ titleMd: "P", position: 2, alertOverrideMin: LONG });
    const { app, page, dataDir } = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 5 * DAY, position: 10 }),
      task({ titleMd: "A", position: 1, alertOverrideMin: LONG }),
      staleTask({ titleMd: "H", createdAt: now - 2 * DAY, position: 3, manuallyPositioned: true }),
      p,
      staleTask({ titleMd: "S", createdAt: now - 3 * DAY, parentId: p.id, position: 1 }),
    ]);
    try {
      await expect.poll(() => readTitles(page)).toEqual(["G1", "A", "P", "  S", "H"]);
      expect(await dragTo(page, taskCard(page, "H"), { row: taskCard(page, "G1"), zone: "upper" })).toBe("group");
      await expect.poll(() => groupTitles(page)).toEqual(["G1", "H"]);
      expect(readMark(dataDir, "H")).toBe(0);
      expect(await dragTo(page, taskCard(page, "S"), { row: taskCard(page, "H"), zone: "upper" })).toBe("group");
      await expect.poll(() => groupTitles(page)).toEqual(["G1", "S", "H"]);
      expect(readMark(dataDir, "S")).toBe(0);
      await expect.poll(() => readTitles(page)).toEqual(["G1", "S", "H", "A", "P"]);
    } finally {
      await app.close();
    }
  });

  test("a stale subtask promoted far below the group stays there, stale and marked (scenario 14)", async () => {
    const now = Date.now();
    const p = task({ titleMd: "P", position: 1, alertOverrideMin: LONG });
    const { app, page, dataDir } = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 5 * DAY, position: 10 }),
      p,
      staleTask({ titleMd: "S", createdAt: now - 3 * DAY, parentId: p.id, position: 1 }),
      task({ titleMd: "M1", position: 2, alertOverrideMin: LONG }),
      task({ titleMd: "M2", position: 3, alertOverrideMin: LONG }),
    ]);
    try {
      expect(await dragTo(page, taskCard(page, "S"), { row: taskCard(page, "M2"), zone: "lower" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["G1", "P", "M1", "M2", "S"]);
      await expect(taskCard(page, "S")).toHaveClass(/stale/);
      expect(readMark(dataDir, "S")).toBe(1);
    } finally {
      await app.close();
    }
  });

  test("FR-012: the order is frozen during a drag while another task goes stale", async () => {
    const now = Date.now();
    const { app, page } = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 4 * DAY, position: 10 }),
      staleTask({ titleMd: "G2", createdAt: now - 3 * DAY, position: 11 }),
      task({ titleMd: "A", position: 1, alertOverrideMin: LONG }),
      task({ titleMd: "Soon", position: 2, createdAt: now - DAY + 3 * MIN }),
      task({ titleMd: "B", position: 3, alertOverrideMin: LONG }),
    ]);
    try {
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "A", "Soon", "B"]);
      // Another task goes stale during a drag: nothing moves until the drag ends.
      await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" }, { release: false });
      await advanceClock(app, 5 * MIN);
      await tick(page);
      await expect(taskCard(page, "Soon")).toHaveClass(/stale/);
      expect(await readTitles(page)).toEqual(["G1", "G2", "A", "Soon", "B"]);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "Soon", "A", "B"]);

    } finally {
      await app.close();
    }
  });

  test("FR-012: a non-stale task held over the group turns stale mid-drag and rejoins on release", async () => {
    const now = Date.now();
    const { app, page } = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 4 * DAY, position: 10 }),
      staleTask({ titleMd: "G2", createdAt: now - 2 * DAY, position: 11 }),
      task({ titleMd: "A", position: 1, alertOverrideMin: LONG }),
      task({ titleMd: "Soon", position: 2, createdAt: now - DAY + 3 * MIN }),
    ]);
    try {
      expect(await dragTo(page, taskCard(page, "Soon"), { row: taskCard(page, "G2"), zone: "upper" }, { release: false })).toBe("line-top");
      await advanceClock(app, 5 * MIN);
      await tick(page);
      await expect.poll(() => readIndicator(page)).toBe("group");
      await page.mouse.up();
      await expect.poll(() => groupTitles(page)).toEqual(["G1", "G2", "Soon"]);
    } finally {
      await app.close();
    }
  });
});

/** US4 — move, promote and demote with the keyboard (004 quickstart 15–18; FR-024 to FR-027). */
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readMark, readOrder, readReminders, readTitles } from "./fixtures/drag";

const LONG = 14_400;
const remCard = (page: Page, text: string) =>
  page.locator("li[data-kind='rem']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });
const status = (page: Page) => page.getByRole("status").filter({ hasText: /position/ });

/** Focuses a card's checkbox (the selected item, spec Assumptions) and presses an Alt+Arrow key. */
async function press(page: Page, title: string, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", rem = false) {
  const card = rem ? remCard(page, title) : taskCard(page, title);
  await card.getByRole("checkbox").focus();
  await page.keyboard.press(`Alt+${key}`);
}

/** The card and control that have keyboard focus. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { title: el?.closest("li")?.querySelector(".title")?.textContent ?? null, ctl: el?.dataset["ctl"] ?? null };
  });

async function setup(rows: ReturnType<typeof task>[], withReminders = false) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  if (withReminders) seedReminders(dataDir, [reminder({ textMd: "R1", position: 1 }), reminder({ textMd: "R2", position: 2 }), reminder({ textMd: "R3", position: 3 })]);
  return launchVesta({ dataDir });
}

function basic() {
  const p = task({ titleMd: "P", position: 4 });
  return [
    task({ titleMd: "A", position: 1 }),
    task({ titleMd: "B", position: 2 }),
    task({ titleMd: "C", position: 3 }),
    p,
    task({ titleMd: "S1", parentId: p.id, position: 1 }),
    task({ titleMd: "S2", parentId: p.id, position: 2 }),
    task({ titleMd: "S3", parentId: p.id, position: 3 }),
  ];
}

test.describe("US4 — keyboard moves", () => {
  test("Alt+Up / Alt+Down move one place per press, keep focus on the same control, stop at the edges (scenario 15)", async () => {
    const { app, page } = await setup(basic(), true);
    try {
      await press(page, "B", "ArrowUp");
      await expect.poll(() => readTitles(page)).toEqual(["B", "A", "C", "P", "  S1", "  S2", "  S3"]);
      await expect.poll(() => focused(page)).toEqual({ title: "B", ctl: "cb" });
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(() => readTitles(page)).toEqual(["A", "B", "C", "P", "  S1", "  S2", "  S3"]);
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(() => readTitles(page)).toEqual(["A", "C", "B", "P", "  S1", "  S2", "  S3"]);

      await press(page, "A", "ArrowUp");
      await press(page, "S3", "ArrowDown");
      await press(page, "S1", "ArrowUp");
      await press(page, "S2", "ArrowUp");
      await expect.poll(() => readTitles(page)).toEqual(["A", "C", "B", "P", "  S2", "  S1", "  S3"]);

      await press(page, "R2", "ArrowDown", true);
      await expect.poll(() => readReminders(page)).toEqual(["R1", "R3", "R2"]);
      await press(page, "R1", "ArrowUp", true);
      await expect.poll(() => readReminders(page)).toEqual(["R1", "R3", "R2"]);
    } finally {
      await app.close();
    }
  });

  test("with an inline editor open the keys reach the editor and nothing moves (US4-8)", async () => {
    const { app, page } = await setup(basic());
    try {
      await taskCard(page, "B").locator(".title").dblclick();
      const editor = page.locator("li[data-kind='task'] [role='textbox']");
      await expect(editor).toBeFocused();
      await page.keyboard.press("Alt+ArrowUp");
      await page.keyboard.press("Alt+ArrowRight");
      await expect(editor).toBeFocused();
      await page.keyboard.press("Escape");
      expect(await readTitles(page)).toEqual(["A", "B", "C", "P", "  S1", "  S2", "  S3"]);
    } finally {
      await app.close();
    }
  });

  test("Alt+Right demotes under a collapsed parent and expands it; Alt+Left promotes; the pair moves a subtask to another parent (scenario 16)", async () => {
    const p = task({ titleMd: "P", position: 1, collapsed: true });
    const q = task({ titleMd: "Q", position: 3 });
    const { app, page } = await setup([p, task({ titleMd: "P1", parentId: p.id, position: 1 }), task({ titleMd: "X", position: 2 }), q, task({ titleMd: "R", position: 4 })]);
    try {
      await expect.poll(() => readTitles(page)).toEqual(["P", "X", "Q", "R"]);
      await press(page, "X", "ArrowRight");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  P1", "  X", "Q", "R"]);
      await expect.poll(() => focused(page)).toEqual({ title: "X", ctl: "cb" });
      await page.keyboard.press("Alt+ArrowLeft");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  P1", "X", "Q", "R"]);
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  P1", "Q", "X", "R"]);
      await page.keyboard.press("Alt+ArrowRight");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  P1", "Q", "  X", "R"]);
    } finally {
      await app.close();
    }
  });

  test("Alt+Left on a stale subtask of a group task lands just below the group, positioned by hand (FR-024b)", async () => {
    const now = Date.now();
    const g = staleTask({ titleMd: "G", createdAt: now - 3 * 86_400_000, position: 9 });
    const { app, page, dataDir } = await setup([g, staleTask({ titleMd: "GS", parentId: g.id, position: 1 }), task({ titleMd: "M", position: 1, alertOverrideMin: LONG })]);
    try {
      await press(page, "GS", "ArrowLeft");
      await expect.poll(() => readTitles(page)).toEqual(["G", "GS", "M"]);
      expect((await readOrder(page)).map((r) => r.inGroup)).toEqual([true, false, false]);
      expect(readMark(dataDir, "GS")).toBe(1);
    } finally {
      await app.close();
    }
  });

  test("next to the stale group: Alt+Up does nothing for a non-stale task, rejoins a positioned-by-hand stale task; group tasks go only down (scenario 17)", async () => {
    const now = Date.now();
    const day = 86_400_000;
    const { app, page, dataDir } = await setup([
      staleTask({ titleMd: "G1", createdAt: now - 4 * day, position: 10 }),
      staleTask({ titleMd: "G2", createdAt: now - 3 * day, position: 11 }),
      task({ titleMd: "M1", position: 1, alertOverrideMin: LONG }),
      staleTask({ titleMd: "H", createdAt: now - 2 * day, position: 2, manuallyPositioned: true }),
      task({ titleMd: "M3", position: 3, alertOverrideMin: LONG }),
    ]);
    try {
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "M1", "H", "M3"]);
      await press(page, "M1", "ArrowUp");
      await press(page, "G2", "ArrowUp");
      await press(page, "G1", "ArrowUp");
      expect(await readTitles(page)).toEqual(["G1", "G2", "M1", "H", "M3"]);
      await press(page, "H", "ArrowUp");
      await expect.poll(() => readTitles(page)).toEqual(["G1", "G2", "H", "M1", "M3"]);
      await press(page, "H", "ArrowUp");
      await expect.poll(() => readOrder(page)).toEqual([
        { title: "G1", level: "top", inGroup: true },
        { title: "G2", level: "top", inGroup: true },
        { title: "H", level: "top", inGroup: true },
        { title: "M1", level: "top", inGroup: false },
        { title: "M3", level: "top", inGroup: false },
      ]);
      expect(readMark(dataDir, "H")).toBe(0);
      await press(page, "G1", "ArrowDown");
      await expect.poll(() => readTitles(page)).toEqual(["G2", "H", "M1", "G1", "M3"]);
      expect(readMark(dataDir, "G1")).toBe(1);
    } finally {
      await app.close();
    }
  });

  test("a polite announcement gives the new position after each keyboard move and drop (scenario 18)", async () => {
    const p = task({ titleMd: "Plan budget", position: 3 });
    const { app, page } = await setup([
      task({ titleMd: "Fix bike", position: 1 }),
      task({ titleMd: "Call accountant", position: 2 }),
      p,
      task({ titleMd: "Gather sales numbers", parentId: p.id, position: 1 }),
      task({ titleMd: "Draft", parentId: p.id, position: 2 }),
    ]);
    try {
      await press(page, "Fix bike", "ArrowDown");
      await expect(status(page)).toHaveText("Fix bike, moved to position 2 of 3");
      await press(page, "Draft", "ArrowUp");
      await expect(status(page)).toHaveText("Draft, moved to position 1 of 2 in Plan budget");
      // Order now: Call accountant, Fix bike, Plan budget.
      await press(page, "Fix bike", "ArrowRight");
      await expect(status(page)).toHaveText("Fix bike, now a subtask of Call accountant, position 1 of 1");
      await press(page, "Fix bike", "ArrowLeft");
      await expect(status(page)).toHaveText("Fix bike, now a top-level task, position 2 of 3");
      await dragTo(page, taskCard(page, "Call accountant"), { row: taskCard(page, "Plan budget"), zone: "middle" });
      await expect(status(page)).toHaveText("Call accountant, now a subtask of Plan budget, position 3 of 3");
    } finally {
      await app.close();
    }
  });
});

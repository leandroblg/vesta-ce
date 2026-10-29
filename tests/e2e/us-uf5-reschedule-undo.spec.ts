/**
 * 016 User Story 1: every reschedule can be undone, and an undone reschedule redone (FR-001 to FR-007, FR-003a,
 * FR-004a, SC-001; PRD Q228, Q247, Q256; ui.md "Undo and redo notice").
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, waitMenuState } from "./fixtures/menu";
import { seedTasks, task } from "./fixtures/seed";

const ago = (ms: number) => Date.now() - ms;
const notice = (page: Page) => page.getByTestId("notification");
const durations = (page: Page) => page.getByRole("menu", { name: "Postpone For" });
const mod = process.platform === "darwin" ? "Meta" : "Control";

async function launch(rows: ReturnType<typeof task>[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  await waitBlinksDone(launched.page);
  return { ...launched, dataDir };
}

function events(dataDir: string, id: string): { kind: string; detail: number | null }[] {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select kind, detail from task_events where task_id = ? order by at, rowid").all(id) as { kind: string; detail: number | null }[];
  } finally {
    db.close();
  }
}

async function hold(page: Page, target: Locator, ms = 650) {
  const b = await target.boundingBox();
  if (b === null) throw new Error("no box");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

type Path = { name: string; run: (page: Page, card: Locator, app: Parameters<typeof clickMenu>[0]) => Promise<void> };

const PATHS: Path[] = [
  { name: "hover click", run: async (_p, card) => clickRevealed(card, card.locator(".act.resched")) },
  {
    name: "hover hold 2h",
    run: async (page, card) => {
      await card.hover();
      await hold(page, card.locator(".act.resched"));
      await durations(page).getByRole("menuitem", { name: "2h" }).click();
    },
  },
  {
    name: "context menu Reschedule",
    run: async (page, card) => {
      await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Reschedule", exact: true }).click();
    },
  },
  {
    name: "context menu Postpone For 4h",
    run: async (page, card) => {
      await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Postpone For" }).click();
      await durations(page).getByRole("menuitem", { name: "4h" }).click();
    },
  },
  {
    name: "Edit › Reschedule",
    run: async (_p, card, app) => {
      await card.locator('[data-ctl="cb"]').focus();
      await waitMenuState(app, "reschedule", { enabled: true });
      await clickMenu(app, "reschedule");
    },
  },
  {
    name: "Edit › Postpone For 1h",
    run: async (_p, card, app) => {
      await card.locator('[data-ctl="cb"]').focus();
      await waitMenuState(app, "postponeFor1", { enabled: true });
      await clickMenu(app, "postponeFor1");
    },
  },
  {
    name: "details panel button",
    run: async (page, card) => {
      await card.locator(".title").click();
      await page.locator(".panel-resched").click();
    },
  },
  {
    name: "details panel hold 2h",
    run: async (page, card) => {
      await card.locator(".title").click();
      await hold(page, page.locator(".panel-resched"));
      await durations(page).getByRole("menuitem", { name: "2h" }).click();
    },
  },
];

test.describe("016 US1 — Undo and Redo a reschedule", () => {
  test("every path shows “{item}” rescheduled. with Undo, and Undo puts the task back exactly (scenarios 1–3)", async () => {
    const rows = PATHS.map((p, i) => task({ titleMd: `T${String(i + 1)} ${p.name}`, position: i + 1, createdAt: ago(30 * HOUR), manuallyPositioned: true }));
    const { app, page, dataDir } = await launch(rows);
    try {
      for (const [i, path] of PATHS.entries()) {
        const title = `T${String(i + 1)} ${path.name}`;
        const card = taskCard(page, title);
        const id = (await card.getAttribute("data-id")) ?? "";
        const before = readTask(dataDir, id);
        expect(before?.stale_since, path.name).not.toBeNull();
        await path.run(page, card, app);
        await expect(notice(page), path.name).toContainText(`“${title}” rescheduled.`);
        await expect(notice(page).getByRole("button", { name: "Undo" })).toBeVisible();
        await expect.poll(() => readTask(dataDir, id)?.stale_since, path.name).toBeNull();
        expect(events(dataDir, id).map((e) => e.kind)).toContain("rescheduled");
        await notice(page).getByRole("button", { name: "Undo" }).click();
        await expect.poll(() => readTask(dataDir, id)?.stale_since, path.name).toBe(before?.stale_since);
        const back = readTask(dataDir, id);
        expect(back?.stale_base_at, path.name).toBe(before?.stale_base_at);
        expect(back?.reschedule_for_min, path.name).toBe(before?.reschedule_for_min);
        expect(back?.position, path.name).toBe(before?.position);
        expect(back?.manually_positioned, path.name).toBe(before?.manually_positioned);
        expect(events(dataDir, id).map((e) => e.kind), path.name).not.toContain("rescheduled");
        await expect(notice(page)).toContainText(`“${title}” reschedule undone.`);
        await page.keyboard.press("Escape");
      }
    } finally {
      await app.close();
    }
  });

  test("Cmd/Ctrl+Z undoes; Redo (button, Cmd/Ctrl+Shift+Z, Edit › Redo) reschedules again for the same duration from now (scenarios 3–5, 10)", async () => {
    const { app, page, dataDir } = await launch([task({ titleMd: "Twice", position: 1, createdAt: ago(30 * HOUR) })]);
    try {
      const card = taskCard(page, "Twice");
      const id = (await card.getAttribute("data-id")) ?? "";
      await card.hover();
      await hold(page, card.locator(".act.resched"));
      await durations(page).getByRole("menuitem", { name: "2h" }).click();
      await expect(notice(page)).toContainText("rescheduled.");
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press(`${mod}+z`);
      await expect(notice(page)).toContainText("“Twice” reschedule undone.");
      await expect(card).toHaveClass(/\bstale\b/);
      await waitMenuState(app, "redo", { enabled: true });

      // The redo record lives 10 s on main's clock too, so the clock moves only after the Redo.
      const undoneBase = readTask(dataDir, id)?.stale_base_at ?? 0;
      await page.keyboard.press(`${mod}+Shift+z`);
      await expect(notice(page)).toContainText("“Twice” rescheduled.");
      await expect.poll(() => readTask(dataDir, id)?.reschedule_for_min).toBe(120);
      expect(events(dataDir, id).filter((e) => e.kind === "rescheduled").map((e) => e.detail)).toEqual([120]);
      expect(readTask(dataDir, id)?.stale_base_at ?? 0).toBeGreaterThan(undoneBase);
      await expect(card).not.toHaveClass(/\bstale\b/);

      // Undo, then Edit › Redo; then the Redo button after another Undo (each record lives 10 s on main's clock).
      await notice(page).getByRole("button", { name: "Undo" }).click();
      await clickMenu(app, "redo");
      await expect(notice(page)).toContainText("rescheduled.");
      await notice(page).getByRole("button", { name: "Undo" }).click();
      await notice(page).getByRole("button", { name: "Redo" }).click();
      await expect(notice(page)).toContainText("rescheduled.");

      // The last Redo counts its 2 h from its own moment.
      await advanceClock(app, 2 * HOUR - MIN);
      await tick(page);
      await expect(card).not.toHaveClass(/\bstale\b/);
      await advanceClock(app, 2 * MIN);
      await tick(page);
      await expect(card).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("a new action replaces Redo, also a title edit; done, Trash and restore offer no Redo (scenarios 7, 8)", async () => {
    const { app, page } = await launch([
      task({ titleMd: "Edited between", position: 1, createdAt: ago(30 * HOUR) }),
      task({ titleMd: "Done one", position: 2, createdAt: ago(HOUR) }),
    ]);
    try {
      const card = taskCard(page, "Edited between");
      await clickRevealed(card, card.locator(".act.resched"));
      await notice(page).getByRole("button", { name: "Undo" }).click();
      await expect(notice(page).getByRole("button", { name: "Redo" })).toBeVisible();
      await card.locator(".title").dblclick();
      await page.keyboard.type(" again");
      await page.keyboard.press("Enter");
      await expect(notice(page)).toHaveCount(0);
      await waitMenuState(app, "redo", { enabled: false });

      await taskCard(page, "Done one").getByRole("checkbox").click();
      await notice(page).getByRole("button", { name: "Undo" }).click();
      await expect(notice(page).getByRole("button", { name: "Redo" })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("Cmd/Ctrl+Z inside an editor undoes typing, never the reschedule (scenario 9)", async () => {
    const { app, page, dataDir } = await launch([task({ titleMd: "Typing", position: 1, createdAt: ago(30 * HOUR) })]);
    try {
      const card = taskCard(page, "Typing");
      const id = (await card.getAttribute("data-id")) ?? "";
      await clickRevealed(card, card.locator(".act.resched"));
      await expect(notice(page)).toContainText("rescheduled.");
      await card.locator(".title").dblclick();
      await page.keyboard.type("x");
      await page.keyboard.press(`${mod}+z`);
      expect(readTask(dataDir, id)?.stale_since).toBeNull();
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("with the details panel open the notice shows, the panel stays open and updates on Undo and Redo (scenario 11)", async () => {
    const { app, page } = await launch([task({ titleMd: "Panel open", position: 1, createdAt: ago(30 * HOUR) })]);
    try {
      await taskCard(page, "Panel open").locator(".title").click();
      await page.locator(".panel-resched").click();
      await expect(notice(page)).toContainText("rescheduled.");
      await expect(page.locator(".panel-resched")).toHaveCount(0);
      await notice(page).getByRole("button", { name: "Undo" }).click();
      await expect(page.locator(".panel-resched")).toBeVisible();
      await notice(page).getByRole("button", { name: "Redo" }).click();
      await expect(page.locator(".panel-resched")).toHaveCount(0);
      await expect(page.getByRole("complementary")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("a failed save on Undo shows Changes are not saved and the list keeps its last saved state (FR-004a)", async () => {
    const { app, page, dataDir } = await launch([task({ titleMd: "Fails", position: 1, createdAt: ago(30 * HOUR) })]);
    try {
      const card = taskCard(page, "Fails");
      const id = (await card.getAttribute("data-id")) ?? "";
      await clickRevealed(card, card.locator(".act.resched"));
      await expect(notice(page)).toContainText("rescheduled.");
      await app.evaluate(() => {
        process.env["VESTA_FAULT"] = "save";
      });
      await notice(page).getByRole("button", { name: "Undo" }).click();
      await expect(notice(page)).toContainText("Changes are not saved");
      expect(readTask(dataDir, id)?.stale_since).toBeNull();
      await expect(card).not.toHaveClass(/\bstale\b/);
    } finally {
      await app.evaluate(() => {
        process.env["VESTA_FAULT"] = "";
      });
      await app.close();
    }
  });
});

/** US1 — reorder by dragging (004 quickstart scenarios 1–5; FR-001 to FR-005, FR-017, FR-022). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { clickRevealed } from "./fixtures/hover";
import { dragTo, readIndicator, readReminders, readTitles, readUpdatedAt } from "./fixtures/drag";
import { backToTasks } from "./fixtures/nav";

const remCard = (page: Page, text: string) =>
  page.locator("li[data-kind='rem']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });
const toast = (page: Page) => page.getByTestId("notification");

/** Cmd/Ctrl+Z goes through the Edit menu's Undo item; Playwright keys never reach native menus (001 research §9). */
async function pressUndoShortcut(app: ElectronApplication) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.getMenuItemById("undo")?.click(undefined, BrowserWindow.getAllWindows()[0]);
  });
}

function abc() {
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

async function setup(withReminders = false) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, abc());
  if (withReminders) {
    seedReminders(dataDir, [reminder({ textMd: "R1", position: 1 }), reminder({ textMd: "R2", position: 2 }), reminder({ textMd: "R3", position: 3 })]);
  }
  return launchVesta({ dataDir });
}

test.describe("US1 — reorder by dragging", () => {
  test("A, B, C: C dropped below A shows a top-level line and gives A, C, B, also after a restart (scenario 1)", async () => {
    const launched = await setup();
    let current = launched;
    try {
      const shown = await dragTo(launched.page, taskCard(launched.page, "C"), { row: taskCard(launched.page, "A"), zone: "lower" });
      expect(shown).toBe("line-top");
      await expect.poll(() => readTitles(launched.page)).toEqual(["A", "C", "B", "P", "  S1", "  S2", "  S3"]);
      current = await relaunch(launched);
      await expect.poll(() => readTitles(current.page)).toEqual(["A", "C", "B", "P", "  S1", "  S2", "  S3"]);
    } finally {
      await current.app.close();
    }
  });

  test("a subtask dropped above another shows a subtask line (scenario 2); a parent moves with its subtasks (US1-9)", async () => {
    const { app, page } = await setup();
    try {
      expect(await dragTo(page, taskCard(page, "S3"), { row: taskCard(page, "S2"), zone: "upper" })).toBe("line-sub");
      await expect.poll(() => readTitles(page)).toEqual(["A", "B", "C", "P", "  S1", "  S3", "  S2"]);
      expect(await dragTo(page, taskCard(page, "P"), { row: taskCard(page, "A"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["P", "  S1", "  S3", "  S2", "A", "B", "C"]);
    } finally {
      await app.close();
    }
  });

  test("reminders reorder among reminders; a reminder over the task list shows nothing and changes nothing (scenario 3)", async () => {
    const { app, page } = await setup(true);
    try {
      expect(await dragTo(page, remCard(page, "R3"), { row: remCard(page, "R1"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readReminders(page)).toEqual(["R3", "R1", "R2"]);
      expect(await dragTo(page, remCard(page, "R1"), { row: taskCard(page, "B"), zone: "upper" })).toBeNull();
      await expect.poll(() => readReminders(page)).toEqual(["R3", "R1", "R2"]);
      expect(await dragTo(page, taskCard(page, "A"), { row: remCard(page, "R2"), zone: "upper" })).toBeNull();
      await expect.poll(() => readTitles(page)).toEqual(["A", "B", "C", "P", "  S1", "  S2", "  S3"]);
    } finally {
      await app.close();
    }
  });

  test("Esc, release outside the window and release at its own place change and save nothing; clicks keep their meaning (scenario 4)", async () => {
    const { app, page, dataDir } = await setup();
    try {
      const before = readUpdatedAt(dataDir, "C");
      expect(await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "A"), zone: "upper" }, { release: false })).toBe("line-top");
      await page.keyboard.press("Escape");
      await expect.poll(() => readIndicator(page)).toBeNull();
      await page.mouse.up();

      await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "A"), zone: "upper" }, { release: false });
      await page.mouse.move(-10, 200, { steps: 4 });
      await page.mouse.up();

      expect(await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "B"), zone: "lower" })).toBeNull();

      await expect.poll(() => readTitles(page)).toEqual(["A", "B", "C", "P", "  S1", "  S2", "  S3"]);
      expect(readUpdatedAt(dataDir, "C")).toBe(before);

      await taskCard(page, "B").locator(".title").click();
      await expect(page.locator("li[data-kind='task'] [role='textbox']")).toHaveCount(0);
      await taskCard(page, "B").locator(".title").dblclick();
      await expect(page.locator("li[data-kind='task'] [role='textbox']")).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test("300 tasks: dragging to the bottom edge scrolls the list; the empty card makes the task last (scenario 5)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, Array.from({ length: 300 }, (_, i) => task({ titleMd: `Row ${String(i)}`, position: i + 1 })));
    const { app, page } = await launchVesta({ dataDir });
    try {
      const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
      await dragTo(page, taskCard(page, "Row 0"), { point: { x: viewport.width / 2, y: viewport.height - 6 } }, { release: false });
      await page.waitForFunction(() => {
        const main = document.querySelector(".main");
        return main !== null && main.scrollTop + main.clientHeight >= main.scrollHeight - 2;
      });
      const empty = await page.locator("li[data-kind='new-task']").boundingBox();
      if (empty === null) throw new Error("empty card not visible");
      await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, { steps: 4 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await readIndicator(page)).toBe("line-top");
      await page.mouse.up();
      await expect.poll(async () => (await readTitles(page)).at(-1)).toBe("Row 0");
    } finally {
      await app.close();
    }
  });

  test("FR-001 and FR-002: controls start no drag; the grip does; the dragged card is dimmed and the ghost shows its title", async () => {
    const { app, page } = await setup();
    try {
      const box = await taskCard(page, "B").getByRole("checkbox").boundingBox();
      if (box === null) throw new Error("no checkbox");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 20, { steps: 4 });
      await expect(page.locator("li.dragging")).toHaveCount(0);
      await page.mouse.up();
      await expect(taskCard(page, "B")).toHaveCount(1);
      await expect(taskCard(page, "B").getByRole("checkbox")).not.toBeChecked();

      await taskCard(page, "B").hover();
      await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" }, { release: false, grab: taskCard(page, "B").locator(".grip") });
      await expect(taskCard(page, "B")).toHaveClass(/dragging/);
      await expect(page.locator(".drag-ghost")).toHaveText("B");
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expect(page.locator("li.dragging")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("FR-003: a drag ends when its item leaves the list (undo of a restore during the drag)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [...abc(), task({ titleMd: "Back", position: 9, doneAt: Date.now() - 1000 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator(".arow").filter({ hasText: "Back" }).getByRole("button", { name: "Restore" }).click();
      await backToTasks(page);
      await expect(toast(page)).toContainText(/” restored\./);
      expect(await dragTo(page, taskCard(page, "Back"), { row: taskCard(page, "A"), zone: "upper" }, { release: false })).toBe("line-top");
      await pressUndoShortcut(app);
      await expect(taskCard(page, "Back")).toHaveCount(0);
      await expect.poll(() => readIndicator(page)).toBeNull();
      await page.mouse.up();
      await expect.poll(() => readTitles(page)).toEqual(["A", "B", "C", "P", "  S1", "  S2", "  S3"]);
    } finally {
      await app.close();
    }
  });

  test("FR-005: no drag from the card being edited; a drag saves another card's edit and closes the menu and the override panel", async () => {
    const { app, page } = await setup();
    try {
      await taskCard(page, "A").locator(".title").dblclick();
      const editor = page.locator("li[data-kind='task'] [role='textbox']");
      await editor.fill("A edited");
      const box = await editor.boundingBox();
      if (box === null) throw new Error("no editor");
      await page.mouse.move(box.x + 10, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 10, box.y + box.height / 2 + 30, { steps: 4 });
      await expect(page.locator("li.dragging")).toHaveCount(0);
      await page.mouse.up();

      await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "B"), zone: "upper" }, { release: false });
      await expect(page.locator("li[data-kind='task'] [role='textbox']")).toHaveCount(0);
      await expect(taskCard(page, "A edited")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await page.mouse.up();

      await clickRevealed(taskCard(page, "B"), taskCard(page, "B").getByRole("button", { name: "More actions" }));
      await expect(page.getByRole("menu")).toBeVisible();
      await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "A edited"), zone: "upper" }, { release: false });
      await expect(page.getByRole("menu")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.mouse.up();

      await clickRevealed(taskCard(page, "B"), taskCard(page, "B").getByRole("button", { name: "More actions" }));
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "A edited"), zone: "upper" }, { release: false });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.mouse.up();
    } finally {
      await app.close();
    }
  });

  test("FR-022: a move leaves the undo notification as it is, and Cmd/Ctrl+Z still undoes", async () => {
    const { app, page } = await setup();
    try {
      await taskCard(page, "B").getByRole("checkbox").click();
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      expect(await dragTo(page, taskCard(page, "C"), { row: taskCard(page, "A"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["C", "A", "P", "  S1", "  S2", "  S3"]);
      await expect(toast(page)).toContainText(/moved to the Archive\./);
      await pressUndoShortcut(app);
      await expect.poll(() => readTitles(page)).toEqual(["C", "A", "B", "P", "  S1", "  S2", "  S3"]);
    } finally {
      await app.close();
    }
  });
});

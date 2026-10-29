// 005 US1: the details panel (quickstart scenarios 1–7, tasks T037).
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, HOUR, readTask } from "./fixtures/clock";
import { caretAtEnd, typeIn } from "./fixtures/editor";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const titleEditor = (page: Page) => panel(page).getByRole("textbox", { name: "Title" });
const detailsEditor = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const savedState = (page: Page) => panel(page).locator(".saved");

async function openByClick(page: Page, title: string): Promise<void> {
  await taskCard(page, title).locator(".title").click();
  await expect(panel(page)).toBeVisible();
  await expect(detailsEditor(page)).toBeVisible();
}

async function setFault(app: import("@playwright/test").ElectronApplication, value: string): Promise<void> {
  await app.evaluate((_e, v) => {
    process.env["VESTA_FAULT"] = v;
  }, value);
}

test.describe("005 US1 — the details panel", () => {
  test("opening: a single click opens it after the double-click time; a double-click edits inline; the menu opens it (1)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Alpha" }), task({ titleMd: "Beta" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const started = Date.now();
      await taskCard(page, "Alpha").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      expect(Date.now() - started).toBeGreaterThanOrEqual(200);
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);

      await taskCard(page, "Beta").locator(".title").dblclick();
      await expect(page.locator("li[data-kind='task'] [role='textbox']")).toBeVisible();
      await page.waitForTimeout(400);
      await expect(panel(page)).toHaveCount(0);
      await page.keyboard.press("Escape");

      await taskCard(page, "Beta").hover();
      await taskCard(page, "Beta").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Show Details" }).click();
      await expect(panel(page)).toBeVisible();
      await expect(titleEditor(page)).toHaveText("Beta");
    } finally {
      await app.close();
    }
  });

  test("parts in order, with the placeholder while the details are empty (2)", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent" });
    seedTasks(dataDir, [parent, task({ titleMd: "Child", parentId: parent.id })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openByClick(page, "Child");
      await expect(panel(page).locator(".panel-kind")).toHaveText("Subtask of Parent");
      const order = await panel(page)
        .locator(".panel-body > *")
        .evaluateAll((els) => els.map((e) => e.getAttribute("class") ?? e.tagName.toLowerCase()));
      // The kind moved into the pane's header (HIG identity, B · Hearth inspector).
      // 015 FR-016, FR-022: the History list follows the created date and status, replacing the Stale history line.
      expect(order).toEqual(["div", "div", "ov-set", "meta-grid", "panel-history"]);
      await expect(panel(page).locator(".meta-grid dt")).toHaveText(["Created", "Status"]);
      await expect(panel(page).locator(".panel-history h3")).toHaveText("History");
      await expect(detailsEditor(page)).toHaveAttribute(
        "data-placeholder",
        "Add details: notes, links, checklists, tables, code…",
      );
      await expect(panel(page).getByRole("heading")).toHaveText(["Subtask of Parent", "History"]);
      await page.keyboard.press("Escape");
      await openByClick(page, "Parent");
      await expect(panel(page).locator(".panel-kind")).toHaveText("Task");
    } finally {
      await app.close();
    }
  });

  test("saving: 500 ms after typing, a green Saved for 3 s; a failed save stays red until a later one succeeds (3)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Notes task" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openByClick(page, "Notes task");
      await typeIn(detailsEditor(page), "first line");
      const typed = Date.now();
      await expect(savedState(page)).toHaveText("Saved", { timeout: 2000 });
      expect(Date.now() - typed).toBeLessThan(1100);
      await expect(savedState(page)).toHaveClass(/ok/);
      expect(readTask(dataDir, a.id)?.details_md).toBe("first line");
      await expect(savedState(page)).toHaveText("", { timeout: 4500 });

      await setFault(app, "save");
      await typeIn(detailsEditor(page), " more");
      await expect(savedState(page)).toHaveText("Changes not saved");
      await expect(savedState(page)).toHaveClass(/fail/);
      // FR-010: the bottom notice is for saves outside the panel only.
      await expect(page.locator(".notif")).toHaveCount(0);
      await page.waitForTimeout(3500);
      await expect(savedState(page)).toHaveText("Changes not saved");
      expect(readTask(dataDir, a.id)?.details_md).toBe("first line");

      await setFault(app, "");
      await typeIn(detailsEditor(page), "!");
      await expect(savedState(page)).toHaveText("Saved");
      expect(readTask(dataDir, a.id)?.details_md).toBe("first line more!");
    } finally {
      await app.close();
    }
  });

  test("title: saved from the panel; an emptied title comes back when the field is left (4)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Old title" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openByClick(page, "Old title");
      await caretAtEnd(titleEditor(page));
      await page.keyboard.type(" plus");
      await expect(savedState(page)).toHaveText("Saved");
      expect(readTask(dataDir, a.id)?.title_md).toBe("Old title plus");
      await expect(taskCard(page, "Old title plus")).toBeVisible();

      await titleEditor(page).focus();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await expect(titleEditor(page)).toHaveText("");
      await detailsEditor(page).focus();
      await expect(titleEditor(page)).toHaveText("Old title plus");
      await page.waitForTimeout(800);
      expect(readTask(dataDir, a.id)?.title_md).toBe("Old title plus");
    } finally {
      await app.close();
    }
  });

  test("closing: ×, Esc and a click outside each save first; another card switches it (4)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "One" });
    const b = task({ titleMd: "Two" });
    seedTasks(dataDir, [a, b]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      for (const [how, text] of [
        ["close button", "x"],
        ["Esc", "e"],
        ["outside", "o"],
      ] as const) {
        await openByClick(page, "One");
        await caretAtEnd(detailsEditor(page));
        await page.keyboard.type(text);
        if (how === "close button") await panel(page).getByRole("button", { name: "Close" }).click();
        if (how === "Esc") await page.keyboard.press("Escape");
        if (how === "outside") await page.locator("header").click({ position: { x: 5, y: 5 } });
        await expect(panel(page), how).toHaveCount(0);
        await expect
          .poll(() => readTask(dataDir, a.id)?.details_md, { message: how })
          .toBe({ "close button": "x", Esc: "xe", outside: "xeo" }[how]);
      }

      // Switching: a click on another card's body switches; the pending edit is saved first.
      await openByClick(page, "One");
      await caretAtEnd(detailsEditor(page));
      await page.keyboard.type("!");
      await taskCard(page, "Two").click({ position: { x: 3, y: 3 } });
      await expect(titleEditor(page)).toHaveText("Two");
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("xeo!");
      // A title click switches too.
      await taskCard(page, "One").locator(".title").click();
      await expect(titleEditor(page)).toHaveText("One");
      await expect(detailsEditor(page)).toHaveText("xeo!");
    } finally {
      await app.close();
    }
  });

  test("an inline edit on another card closes the panel, saving its pending edit first (edge case)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Open one" });
    const b = task({ titleMd: "Edit me" });
    seedTasks(dataDir, [a, b]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      // By a double-click on the other card's title.
      await openByClick(page, "Open one");
      await caretAtEnd(detailsEditor(page));
      await page.keyboard.type("pending");
      await taskCard(page, "Edit me").locator(".title").dblclick();
      await expect(panel(page)).toHaveCount(0);
      await expect(page.locator("li[data-kind='task'] .inline-edit [role='textbox']")).toBeFocused();
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("pending");
      await page.keyboard.press("Escape");

      // By the other card's Edit button.
      await openByClick(page, "Open one");
      await taskCard(page, "Edit me").hover();
      await taskCard(page, "Edit me").getByRole("button", { name: "Edit" }).click();
      await expect(panel(page)).toHaveCount(0);
      await page.keyboard.press("Escape");

      // Editing the panel's own item inline keeps the panel.
      await openByClick(page, "Open one");
      await taskCard(page, "Open one").hover();
      await taskCard(page, "Open one").getByRole("button", { name: "Edit" }).click();
      await expect(panel(page)).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("a reminder click closes it; another card's checkbox closes it and marks that item done (4)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Shown" }), task({ titleMd: "Other" })]);
    seedReminders(dataDir, [reminder({ textMd: "Call the bank" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openByClick(page, "Shown");
      await page
        .locator("li[data-kind='rem']")
        .first()
        .click({ position: { x: 40, y: 8 } });
      await expect(panel(page)).toHaveCount(0);

      await openByClick(page, "Shown");
      await taskCard(page, "Other").getByRole("checkbox").click();
      await expect(panel(page)).toHaveCount(0);
      await expect(taskCard(page, "Other")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("done by the panel item's own checkbox closes it, and undo does not reopen it (5)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Finish" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openByClick(page, "Finish");
      await taskCard(page, "Finish").getByRole("checkbox").click();
      await expect(panel(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(taskCard(page, "Finish")).toBeVisible();
      await page.waitForTimeout(300);
      await expect(panel(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("status lines, history, Reschedule and the override fields (6)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [
      staleTask({ titleMd: "Old one" }),
      task({ titleMd: "Fresh one", createdAt: now - 2 * HOUR }),
      task({ titleMd: "Moved one", createdAt: now - 3 * DAY, staleBaseAt: now - HOUR, wasStale: true }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openByClick(page, "Old one");
      const status = panel(page).locator(".meta-grid dd").nth(1);
      await expect(status).toContainText("Stale since");
      const history = panel(page).locator(".panel-history li");
      await expect(history.and(panel(page).locator("[data-kind='stale']"))).toHaveCount(1);
      await panel(page).getByRole("button", { name: "Reschedule" }).click();
      await expect(status).toContainText("Rescheduled · stale again in");
      await expect(history.first()).toHaveAttribute("data-kind", "rescheduled");
      await expect(panel(page).getByRole("button", { name: "Reschedule" })).toHaveCount(0);

      await taskCard(page, "Fresh one").locator(".title").click();
      await expect(titleEditor(page)).toHaveText("Fresh one");
      await expect(status).toHaveText(/^Goes stale in /);
      await expect(panel(page).locator(".panel-history li")).toHaveCount(1);
      await expect(panel(page).locator(".panel-history li").first()).toHaveAttribute("data-kind", "created");

      await taskCard(page, "Moved one").locator(".title").click();
      await expect(titleEditor(page)).toHaveText("Moved one");
      await expect(status).toHaveText(/^Rescheduled · stale again in /);

      // The override behaves as 003's modal: untick, then a 2-hour period makes it stale at the next tick.
      const useGlobal = panel(page).getByRole("checkbox", { name: /Use the global default/ });
      await expect(useGlobal).toBeChecked();
      await useGlobal.uncheck();
      const days = panel(page).getByRole("spinbutton", { name: "Days" });
      await days.fill("0");
      await panel(page).getByRole("spinbutton", { name: "Hours" }).fill("0");
      await expect(panel(page).locator(".ov-err")).toHaveText("The minimum is 1 hour.");
      await panel(page).getByRole("spinbutton", { name: "Hours" }).fill("2");
      await expect(panel(page).locator(".ov-err")).toHaveText("");
    } finally {
      await app.close();
    }
  });

  test("width: resized within its limits, restored after restart, an overlay with no handle at 700 px (7)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Wide" })]);
    let run = await launchVesta({ dataDir });
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
      await openByClick(run.page, "Wide");
      const width = () => panel(run.page).evaluate((el) => el.getBoundingClientRect().width);
      expect(await width()).toBeCloseTo(420, 0);
      const handle = panel(run.page).getByRole("separator", { name: "Resize panel" });
      const drag = async (toX: number) => {
        const box = await handle.boundingBox();
        if (box === null) throw new Error("no handle");
        await run.page.mouse.move(box.x + box.width / 2, box.y + 100);
        await run.page.mouse.down();
        await run.page.mouse.move(toX, box.y + 100, { steps: 5 });
        await run.page.mouse.up();
      };
      await drag(1300);
      await expect.poll(width).toBeCloseTo(300, 0);
      await drag(0);
      await expect.poll(width).toBeCloseTo(760, 0);
      await drag(1400 - 512);
      const kept = await width();
      expect(kept).toBeGreaterThan(480);
      expect(kept).toBeLessThan(540);

      run = await relaunch(run);
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
      await openByClick(run.page, "Wide");
      await expect.poll(width).toBeCloseTo(kept, 0);

      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(700, 800));
      await expect.poll(() => panel(run.page).evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
      await expect(panel(run.page).locator(".panel-resize")).toBeHidden();
      expect(await width()).toBeLessThanOrEqual(440);
    } finally {
      await run.app.close();
    }
  });

  test("text undo and redo in the details editor do not undo the list (FR-039)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Done earlier" }), task({ titleMd: "Edited" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Done earlier").getByRole("checkbox").click();
      await expect(taskCard(page, "Done earlier")).toHaveCount(0);
      await openByClick(page, "Edited");
      await typeIn(detailsEditor(page), "abc");
      await expect(detailsEditor(page)).toHaveText("abc");
      await page.keyboard.press("ControlOrMeta+z");
      await expect(detailsEditor(page)).not.toHaveText("abc");
      await expect(taskCard(page, "Done earlier")).toHaveCount(0);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await expect(detailsEditor(page)).toHaveText("abc");
    } finally {
      await app.close();
    }
  });

  test("closing the window right after typing still saves the details (FR-009)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Quick" });
    seedTasks(dataDir, [a]);
    const run = await launchVesta({ dataDir });
    await openByClick(run.page, "Quick");
    await typeIn(detailsEditor(run.page), "typed just before quitting");
    await run.app.close();
    expect(readTask(dataDir, a.id)?.details_md).toBe("typed just before quitting");
  });

  test("SC-002: killing the app 500 ms after Saved shows keeps the details", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Durable" });
    seedTasks(dataDir, [a]);
    const run = await launchVesta({ dataDir });
    await openByClick(run.page, "Durable");
    await typeIn(detailsEditor(run.page), "kept after a kill");
    await expect(savedState(run.page)).toHaveText("Saved");
    await run.page.waitForTimeout(500);
    run.app.process().kill("SIGKILL");
    await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("kept after a kill");
  });
});

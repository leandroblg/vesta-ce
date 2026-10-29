// 018 US6 (FR-027 to FR-031, AC1–AC7, SC-007; PRD Q275): Esc with the details panel closed, and a click outside the
// panel and every card, clear the selection in the main view, the Archive and the Trash; inline edits keep their rules.
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, waitMenuState } from "./fixtures/menu";
import { reminderCard } from "./fixtures/reminders";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { capture, openSettings, selectedTitle } from "./fixtures/settings";

const NOW = Date.now();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const noSelection = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return (a === null || a.closest("li[data-kind]") === null) && document.querySelector("li[data-kind][data-selected]") === null;
  });
const openView = (page: Page, view: "Archive" | "Trash") => page.getByRole("button", { name: new RegExp(`^${view}`) }).click();

const FIX_BIKE = task({ titleMd: "Fix bike", position: 1 });
const CALL_MOM = reminder({ textMd: "Call mom" });

function seed() {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [
    FIX_BIKE,
    task({ titleMd: "Renew passport", position: 2 }),
    task({ titleMd: "Old done", doneAt: NOW - DAY }),
    task({ titleMd: "Old gone", deletedAt: NOW - DAY }),
  ]);
  return dataDir;
}

function reminderText(dataDir: string, id: string): string | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    return (db.prepare("select text_md as t from reminders where id = ?").get(id) as { t: string } | undefined)?.t;
  } finally {
    db.close();
  }
}

async function selectFirst(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => selectedTitle(page)).not.toBeNull();
}

async function expectCleared(page: Page) {
  await expect.poll(() => noSelection(page)).toBe(true);
}

async function emptySpace(page: Page) {
  const main = await page.locator("main").boundingBox();
  if (main === null) throw new Error("no main");
  await page.mouse.click(main.x + main.width - 8, main.y + main.height - 8);
}

test("(a) (d) Esc and a click on empty space clear a selection in the three views; ArrowDown selects again", async () => {
  const { app, page } = await launchVesta({ dataDir: seed() });
  try {
    for (const view of ["tasks", "Archive", "Trash"] as const) {
      if (view !== "tasks") await openView(page, view);
      await selectFirst(page);
      await page.keyboard.press("Escape");
      await expectCleared(page);
      await page.keyboard.press("Escape");
      await expectCleared(page);
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => selectedTitle(page)).not.toBeNull();
      await emptySpace(page);
      await expectCleared(page);
    }
  } finally {
    await app.close();
  }
});

test("(b) (c) with the panel open, Esc closes it and keeps the selection; a click outside closes it and clears it", async () => {
  const { app, page } = await launchVesta({ dataDir: seed() });
  try {
    await selectFirst(page);
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    expect(await selectedTitle(page)).toBe("Fix bike");
    await page.keyboard.press("Escape");
    await expectCleared(page);
    for (const where of ["empty", "heading", "search"] as const) {
      await selectFirst(page);
      await page.keyboard.press("Enter");
      await expect(panel(page)).toBeVisible();
      if (where === "empty") await emptySpace(page);
      else if (where === "heading") await page.locator("header .brand").click();
      else await page.getByRole("searchbox").click();
      await expect(panel(page)).toBeHidden();
      await expectCleared(page);
    }
  } finally {
    await app.close();
  }
});

test("(e) menus, popovers and dialogs closed with Esc leave the selection; (g) the Esc row and a remapped key", async () => {
  const { app, page } = await launchVesta({ dataDir: seed() });
  try {
    await selectFirst(page);
    const first = page.locator("li[data-kind='task']").first();
    await first.hover();
    await first.locator("[data-ctl='more']").click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    expect(await selectedTitle(page)).toBe("Fix bike");
    // T084: Settings, the alert override and About closed with Esc leave the same card selected.
    await openSettings(page, "General");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    await expect.poll(() => selectedTitle(page)).toBe("Fix bike");
    await first.hover();
    await first.locator("[data-ctl='more']").click();
    await page.getByRole("menuitem", { name: "Alert Period…" }).click();
    await expect(page.getByRole("dialog", { name: "Alert override" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Alert override" })).toBeHidden();
    await expect.poll(() => selectedTitle(page)).toBe("Fix bike");
    await clickMenu(app, "about");
    await expect(page.getByRole("dialog", { name: /Vesta/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Vesta/ })).toBeHidden();
    await expect.poll(() => selectedTitle(page)).toBe("Fix bike");
    await openSettings(page, "Shortcuts");
    await expect(page.getByRole("dialog", { name: "Settings" })).toContainText("Close Panel, Cancel Edit or Clear Selection");
    await capture(page, "Close Panel, Cancel Edit or Clear Selection", "F9");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    await selectFirst(page);
    await page.keyboard.press("F9");
    await expectCleared(page);
  } finally {
    await app.close();
  }
});

test("(f) an inline edit: Esc discards it and keeps the card; a click outside saves it, then clears", async () => {
  const dataDir = seed();
  const { app, page } = await launchVesta({ dataDir });
  try {
    await selectFirst(page);
    const inline = page.locator("li[data-kind='task'] .ProseMirror").first();
    await page.keyboard.press("F2");
    await expect(inline).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" changed");
    await page.keyboard.press("Escape");
    await expect(page.locator("li[data-kind='task'] .title").first()).toHaveText("Fix bike");
    expect(await selectedTitle(page)).toBe("Fix bike");
    await page.keyboard.press("F2");
    await expect(inline).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" now");
    await emptySpace(page);
    await expect(page.locator("li[data-kind='task'] .title").first()).toHaveText("Fix bike now");
    await expect.poll(() => readTask(dataDir, FIX_BIKE.id)?.title_md).toBe("Fix bike now");
    await expectCleared(page);
  } finally {
    await app.close();
  }
});

test("(h) a click on the footer row clears; (i) after a clear, Move to Trash and Restore are disabled (FR-031)", async () => {
  const { app, page } = await launchVesta({ dataDir: seed() });
  try {
    await selectFirst(page);
    // The footer row is outside every card: the card it leaves is no longer selected, then a new task starts.
    await page.locator("[data-list='tasks'] .newbtn").last().click();
    await expect.poll(() => selectedTitle(page)).not.toBe("Fix bike");
    await page.keyboard.press("Escape");
    await selectFirst(page);
    await waitMenuState(app, "trash", { enabled: true });
    await page.keyboard.press("Escape");
    await expectCleared(page);
    await waitMenuState(app, "trash", { enabled: false });
    await openView(page, "Archive");
    await selectFirst(page);
    await waitMenuState(app, "restore", { enabled: true });
    await emptySpace(page);
    await expectCleared(page);
    await waitMenuState(app, "restore", { enabled: false });
    await waitMenuState(app, "trash", { enabled: false });
  } finally {
    await app.close();
  }
});

test("(j) T087 an inline reminder edit: a click outside saves it to its row, then clears the selection", async () => {
  const dataDir = seed();
  seedReminders(dataDir, [CALL_MOM]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    const card = reminderCard(page, "Call mom");
    await card.locator(".title").dblclick();
    const editor = page.locator("li[data-kind='rem'] [role='textbox']");
    await expect(editor).toBeFocused();
    await expect(editor).toHaveText("Call mom");
    await page.keyboard.press("End");
    await page.keyboard.type(" now");
    await emptySpace(page);
    await expect(reminderCard(page, "Call mom now")).toBeVisible();
    await expect.poll(() => reminderText(dataDir, CALL_MOM.id)).toBe("Call mom now");
    await expectCleared(page);
  } finally {
    await app.close();
  }
});

test("(k) T087 the read-only panel in the Archive and the Trash: a click outside closes it and clears; a click on the heading clears", async () => {
  const { app, page } = await launchVesta({ dataDir: seed() });
  try {
    for (const view of ["Archive", "Trash"] as const) {
      await openView(page, view);
      await selectFirst(page);
      await page.keyboard.press("Enter");
      await expect(panel(page)).toBeVisible();
      await emptySpace(page);
      await expect(panel(page)).toBeHidden();
      await expectCleared(page);
      await selectFirst(page);
      await page.locator("#view-h").click();
      await expectCleared(page);
    }
  } finally {
    await app.close();
  }
});

test("(l) T087 Esc in the search box acts on the box: it clears the text and keeps the focus there", async () => {
  const { app, page } = await launchVesta({ dataDir: seed() });
  try {
    const box = page.getByRole("searchbox");
    await box.click();
    await page.keyboard.type("bike");
    await page.keyboard.press("Escape");
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
  } finally {
    await app.close();
  }
});

test("(m) T087 a remapped Close key closes the panel keeping the selection and cancels an inline edit; Esc no longer clears", async () => {
  const dataDir = seed();
  const { app, page } = await launchVesta({ dataDir });
  try {
    await openSettings(page, "Shortcuts");
    await capture(page, "Close Panel, Cancel Edit or Clear Selection", "F9");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeHidden();
    await selectFirst(page);
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("F9");
    await expect(panel(page)).toBeHidden();
    expect(await selectedTitle(page)).toBe("Fix bike");
    const inline = page.locator("li[data-kind='task'] .ProseMirror").first();
    await page.keyboard.press("F2");
    await expect(inline).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.type(" changed");
    await page.keyboard.press("F9");
    await expect(page.locator("li[data-kind='task'] .title").first()).toHaveText("Fix bike");
    expect(readTask(dataDir, FIX_BIKE.id)?.title_md).toBe("Fix bike");
    await expect.poll(() => selectedTitle(page)).toBe("Fix bike");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    expect(await selectedTitle(page)).toBe("Fix bike");
  } finally {
    await app.close();
  }
});

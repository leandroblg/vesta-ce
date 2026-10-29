/** US5 — reach the search from the keyboard (006 quickstart 13–14; FR-020 to FR-023, SC-006). */
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { search, searchBox, searchSettled } from "./fixtures/search";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());
const live = (page: Page) => page.locator("[role='status'][aria-live='polite']");

async function expectBoxFocusedAndSelected(page: Page): Promise<void> {
  await expect(searchBox(page)).toBeFocused();
  const sel = await searchBox(page).evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.value.length]);
  expect(sel[0]).toBe(0);
  expect(sel[1]).toBe(sel[2]);
}

function stored(dataDir: string, sql: string, arg: string): unknown {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    return db.prepare(sql).pluck().get(arg);
  } finally {
    db.close();
  }
}

function seed(dataDir: string) {
  seedTasks(dataDir, [
    task({ titleMd: "Fix bike", position: 1 }),
    task({ titleMd: "Plan trip", position: 2 }),
    task({ titleMd: "Old done thing", doneAt: Date.now() - DAY }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "Water plants", position: 1 })]);
}

test.describe("006 US5 — keyboard", () => {
  test("Cmd/Ctrl+F from the list focuses the box with its text selected (13)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "bike");
      await taskCard(page, "Fix bike").getByRole("checkbox").focus();
      await page.keyboard.press("ControlOrMeta+f");
      await expectBoxFocusedAndSelected(page);
    } finally {
      await app.close();
    }
  });

  test("from an inline title or reminder editor, the edit is saved and the box takes focus (13)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Plan trip").locator(".title").dblclick();
      // The editor is created after the double click; keys sent before it has the focus are not its own.
      await expect(page.locator("li.editing .ProseMirror")).toBeFocused();
      await page.keyboard.press("End");
      await page.keyboard.type(" to Rome");
      await page.keyboard.press("ControlOrMeta+f");
      await expectBoxFocusedAndSelected(page);
      await expect.poll(() => taskTitles(page)).toContain("Plan trip to Rome");
      await page.locator("li[data-kind='rem'] .title", { hasText: "Water plants" }).dblclick();
      await expect(page.locator("li.editing .ProseMirror")).toBeFocused();
      await page.keyboard.press("End");
      await page.keyboard.type(" daily");
      await page.keyboard.press("ControlOrMeta+f");
      await expectBoxFocusedAndSelected(page);
      await expect(page.locator("li[data-kind='rem'] .title")).toHaveText(["Water plants daily"]);
    } finally {
      await app.close();
    }
  });

  test("from the details panel, the pending edit is saved at once and the panel stays open (13)", async () => {
    const dataDir = freshDataDir();
    const bike = task({ titleMd: "Fix bike", position: 1 });
    seedTasks(dataDir, [bike]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Fix bike").locator(".title").click();
      await panel(page).getByRole("textbox", { name: "Details" }).click();
      await page.keyboard.type("new chain");
      await page.keyboard.press("ControlOrMeta+f");
      await expectBoxFocusedAndSelected(page);
      await expect(panel(page)).toBeVisible();
      await expect.poll(() => stored(dataDir, "select details_md from tasks where id = ?", bike.id)).toBe("new chain");
    } finally {
      await app.close();
    }
  });

  test("from the Archive view the box takes focus, and typing opens the main view (14, FR-020)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /Archive/ }).first().click();
      await expect(page.getByRole("heading", { level: 1, name: "Archive" })).toBeVisible();
      await page.keyboard.press("ControlOrMeta+f");
      await expect(searchBox(page)).toBeFocused();
      await page.keyboard.type("bike");
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual(["Fix bike"]);
    } finally {
      await app.close();
    }
  });

  test("Esc clears a box with text and keeps focus; on an empty box it closes the panel (FR-022)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Fix bike").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press("ControlOrMeta+f");
      await page.keyboard.type("bike");
      await searchSettled(page);
      await page.keyboard.press("Escape");
      await expect(searchBox(page)).toHaveValue("");
      await expect(searchBox(page)).toBeFocused();
      await expect(panel(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("the number of results is announced politely after typing pauses (FR-023)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "bike");
      await expect(live(page)).toHaveText("1 result");
      await search(page, "zzzz");
      await expect(live(page)).toHaveText("No results");
      await search(page, "i");
      await expect(live(page)).toHaveText(/^\d+ results$/);
    } finally {
      await app.close();
    }
  });
});

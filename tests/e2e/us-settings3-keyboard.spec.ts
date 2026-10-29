/** 007 User Story 3: keyboard navigation on the main view, the Archive and the Trash (quickstart 13–19, 18a; T052). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminderCard } from "./fixtures/reminders";
import { reminder, seedReminders, seedSetting, seedTasks, task } from "./fixtures/seed";
import { searchBox } from "./fixtures/search";
import { MOD, dialog, openSettings, selectedTitle } from "./fixtures/settings";
import { nextConfirm } from "./fixtures/files";

const NOW = Date.now();

function seedMain(dataDir: string, extra: { collapsedReminders?: boolean } = {}) {
  const p = task({ titleMd: "Parent", position: 1 });
  const c = task({ titleMd: "Closed", position: 2, collapsed: true });
  seedTasks(dataDir, [
    p,
    task({ titleMd: "Sub one", parentId: p.id, position: 1 }),
    task({ titleMd: "Sub two", parentId: p.id, position: 2 }),
    c,
    task({ titleMd: "Hidden sub", parentId: c.id, position: 1 }),
    task({ titleMd: "Last", position: 3 }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "Rem one", position: 1 }), reminder({ textMd: "Rem two", position: 2 })]);
  if (extra.collapsedReminders === true) seedSetting(dataDir, "remindersCollapsed", true);
}

async function start(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

async function walk(page: Page, key: "ArrowDown" | "ArrowUp", times: number): Promise<(string | null)[]> {
  const seen: (string | null)[] = [];
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    seen.push(await selectedTitle(page));
  }
  return seen;
}

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

test.describe("007 US3 — keyboard navigation", () => {
  test("Up/Down walk the shown cards in on-screen order, skip hidden ones, stop at the ends (US3-1, US3-2, FR-025)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      expect(await walk(page, "ArrowDown", 8)).toEqual(["Rem one", "Rem two", "Parent", "Sub one", "Sub two", "Closed", "Last", "Last"]);
      await start(page);
      expect(await walk(page, "ArrowUp", 1)).toEqual(["Last"]);
    } finally {
      await app.close();
    }
  });

  test("a collapsed Reminders section is skipped", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir, { collapsedReminders: true });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      expect(await walk(page, "ArrowDown", 1)).toEqual(["Parent"]);
    } finally {
      await app.close();
    }
  });

  test("Enter opens the panel; the panel follows the selection; a reminder closes it (US3-3, FR-026, FR-027)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await walk(page, "ArrowDown", 3);
      await page.keyboard.press("Enter");
      await expect(panel(page)).toBeVisible();
      await expect(panel(page).getByRole("textbox", { name: "Title" })).toHaveText("Parent");
      expect(await selectedTitle(page)).toBe("Parent");
      await page.keyboard.press("ArrowDown");
      await expect(panel(page).getByRole("textbox", { name: "Title" })).toHaveText("Sub one");
      await walk(page, "ArrowUp", 2);
      await expect(panel(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test("F2 edits the selected title, and the card is selected again after Enter or Esc (US3-4, FR-028)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await walk(page, "ArrowDown", 7);
      await page.keyboard.press("F2");
      const editor = page.getByRole("textbox", { name: "Last" });
      await expect(editor).toBeFocused();
      await editor.fill("Last one");
      await page.keyboard.press("Enter");
      await expect(taskCard(page, "Last one")).toBeVisible();
      await expect.poll(() => selectedTitle(page)).toBe("Last one");
      await page.keyboard.press("F2");
      await page.keyboard.press("Escape");
      await expect.poll(() => selectedTitle(page)).toBe("Last one");
    } finally {
      await app.close();
    }
  });

  test("done and delete move the selection next, else previous, else to the empty card; undo selects the item again (US3-5, FR-029)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await walk(page, "ArrowDown", 7);
      await page.keyboard.press("Delete");
      await expect(taskCard(page, "Last")).toHaveCount(0);
      await expect.poll(() => selectedTitle(page)).toBe("Closed");
      // A parent takes its subtasks: the next card is the one after them.
      await start(page);
      await walk(page, "ArrowDown", 3);
      await page.keyboard.press(`${MOD}+Enter`);
      await expect(taskCard(page, "Parent")).toHaveCount(0);
      await expect.poll(() => selectedTitle(page)).toBe("Closed");
      await page.keyboard.press(`${MOD}+z`);
      await expect(taskCard(page, "Parent")).toBeVisible();
      await expect.poll(() => selectedTitle(page)).toBe("Parent");
      // Backspace deletes a reminder too.
      await start(page);
      await walk(page, "ArrowDown", 2);
      await page.keyboard.press("Backspace");
      await expect(reminderCard(page, "Rem two")).toHaveCount(0);
      // The next shown card comes first: the first task, after the reminders.
      await expect.poll(() => selectedTitle(page)).toBe("Parent");
    } finally {
      await app.close();
    }
  });

  test("deleting the only card focuses the list's empty card", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Alone" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Delete");
      await expect(page.locator("[data-list='tasks'] .newbtn")).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("Left and Right collapse and expand; Left on a subtask collapses its parent and selects it; nothing during a search (US3-6, FR-030)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await walk(page, "ArrowDown", 4);
      expect(await selectedTitle(page)).toBe("Sub one");
      await page.keyboard.press("ArrowLeft");
      await expect(taskCard(page, "Sub one")).toHaveCount(0);
      await expect.poll(() => selectedTitle(page)).toBe("Parent");
      await page.keyboard.press("ArrowRight");
      await expect(taskCard(page, "Sub one")).toBeVisible();
      await start(page);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowLeft");
      await expect(reminderCard(page, "Rem one")).toBeVisible();

      await searchBox(page).fill("Parent");
      await taskCard(page, "Parent").locator("[data-ctl='cb']").focus();
      await page.keyboard.press("ArrowLeft");
      await searchBox(page).fill("");
      await expect(taskCard(page, "Sub one")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("New subtask, New task and New reminder (US3-8, US3-9, FR-031)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir, { collapsedReminders: true });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await walk(page, "ArrowDown", 2);
      expect(await selectedTitle(page)).toBe("Sub one");
      await page.keyboard.press(`${MOD}+Shift+N`);
      await expect(page.getByRole("textbox", { name: "New subtask…" })).toBeFocused();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /Archive/ }).first().click();
      await page.keyboard.press(`${MOD}+N`);
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
      await page.keyboard.press("Escape");

      await page.keyboard.press(`${MOD}+Shift+R`);
      await expect(page.getByRole("textbox", { name: "New reminder…" })).toBeFocused();
      await expect(reminderCard(page, "Rem one")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("New reminder does nothing at 200 active reminders", async () => {
    const dataDir = freshDataDir();
    seedReminders(
      dataDir,
      Array.from({ length: 200 }, (_, i) => reminder({ textMd: `R${String(i)}`, position: i + 1 })),
    );
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.keyboard.press(`${MOD}+Shift+R`);
      await expect(page.getByRole("textbox", { name: "New reminder…" })).toHaveCount(0);
      await expect(page.getByText("Maximum reminders reached")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("Esc closes the innermost thing; Close remapped to F9 governs the inline edit and the panel; Esc still closes Settings (FR-032)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    seedSetting(dataDir, "shortcuts", { close: ["F9"] });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Last").locator(".title").dblclick();
      await page.getByRole("textbox", { name: "Last" }).fill("Changed");
      await page.keyboard.press("F9");
      await expect(taskCard(page, "Last")).toBeVisible();
      await taskCard(page, "Last").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      await taskCard(page, "Last").locator("[data-ctl='cb']").focus();
      await page.keyboard.press("F9");
      await expect(panel(page)).toBeHidden();
      await openSettings(page, "Shortcuts");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test("Mod+R and Mod+Shift+R never reload; Mod+Shift+R starts a reminder (research §13; T033 covers released builds)", async () => {
    const { app, page } = await launchVesta();
    try {
      await page.evaluate(() => {
        (window as unknown as { __marker: number }).__marker = 7;
      });
      await page.keyboard.press(`${MOD}+r`);
      await page.keyboard.press(`${MOD}+Shift+R`);
      await expect(page.getByRole("textbox", { name: "New reminder…" })).toBeFocused();
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(7);
    } finally {
      await app.close();
    }
  });

  test("keys typed in an editor or a field never act on a card (SC-002, US3-7)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const count = () => page.locator("li[data-id]").count();
      const before = await count();
      await taskCard(page, "Last").locator(".title").dblclick();
      const editor = page.getByRole("textbox", { name: "Last" });
      for (const k of ["ArrowDown", "ArrowUp", "F2", "Delete", "Backspace", "ArrowLeft"]) await editor.press(k);
      await editor.press("Escape");
      await searchBox(page).fill("x");
      for (const k of ["ArrowDown", "Enter", "Delete", `${MOD}+Enter`]) await searchBox(page).press(k);
      await searchBox(page).fill("");
      expect(await count()).toBe(before);
      await expect(panel(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test("a click on a card selects it; Tab reaches its hover buttons, visible while focused (FR-024, CHK017)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const card = taskCard(page, "Parent");
      const box = await card.boundingBox();
      await page.mouse.click((box?.x ?? 0) + 4, (box?.y ?? 0) + 4);
      await expect.poll(() => selectedTitle(page)).toBe("Parent");
      await page.keyboard.press("ArrowDown");
      expect(await selectedTitle(page)).toBe("Sub one");
      const sub = taskCard(page, "Sub one");
      for (const name of ["Edit", "More actions"]) {
        let found = false;
        for (let i = 0; i < 6 && !found; i++) {
          await page.keyboard.press("Tab");
          found = await sub.getByRole("button", { name, exact: true }).evaluate((b) => b === document.activeElement);
        }
        expect(found, name).toBe(true);
        await expect(sub.getByRole("button", { name, exact: true })).toBeVisible();
      }
    } finally {
      await app.close();
    }
  });

  test("a selected card that disappears leaves the focus on its list (CHK021)", async () => {
    const dataDir = freshDataDir();
    seedMain(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await start(page);
      await walk(page, "ArrowDown", 4);
      // Collapses the parent without moving the focus, as a change from elsewhere would.
      await taskCard(page, "Parent").locator("[data-ctl='twisty']").evaluate((b) => {
        (b as HTMLButtonElement).click();
      });
      await expect(taskCard(page, "Sub one")).toHaveCount(0);
      await expect(page.locator("[data-list='tasks']")).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("Archive and Trash: Up/Down, Enter opens details read-only, Shift+Enter restores, Delete arms then deletes in the Trash, nothing else acts (US3-10 to US3-13, FR-031a; 011 FR-022b)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [
      task({ titleMd: "Done A", doneAt: NOW - 3000 }),
      task({ titleMd: "Done B", doneAt: NOW - 2000 }),
      task({ titleMd: "Gone A", deletedAt: NOW - 3000 }),
      task({ titleMd: "Gone B", deletedAt: NOW - 2000 }),
    ]);
    seedReminders(dataDir, [reminder({ textMd: "Done R", doneAt: NOW - 1000 }), reminder({ textMd: "Gone R", deletedAt: NOW - 1000 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /Archive/ }).first().click();
      await start(page);
      // 014 FR-008 (PRD Q193): Reminders first, then Tasks, as on screen.
      expect(await walk(page, "ArrowDown", 4)).toEqual(["Done R", "Done B", "Done A", "Done A"]);
      for (const k of ["F2", `${MOD}+Enter`, "Alt+ArrowUp", "ArrowLeft"]) await page.keyboard.press(k);
      await expect(page.locator("main li[data-id]")).toHaveCount(3);
      // 018 FR-009: Delete now moves the selected Archive entry to the Trash.
      await page.keyboard.press("Delete");
      await expect(page.locator("main li[data-id]")).toHaveCount(2);
      await expect(page.getByTestId("notification")).toContainText("“Done A” moved to the Trash.");
      await start(page);
      await walk(page, "ArrowDown", 2);
      // 011 FR-022b (PRD Q144): Enter opens the details read-only; Esc closes them and the row is selected again.
      await page.keyboard.press("Enter");
      const panel = page.getByRole("complementary", { name: "Details" });
      await expect(panel).toHaveAttribute("data-readonly", "");
      await expect(panel).toContainText("Done B");
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect.poll(() => selectedTitle(page)).toBe("Done B");
      await page.keyboard.press("Shift+Enter");
      await expect(page.locator("main")).not.toContainText("Done B");
      // "Done A" went to the Trash above, so the selection moves to the row left.
      await expect.poll(() => selectedTitle(page)).toBe("Done R");
      await page.keyboard.press(`${MOD}+z`);
      await expect(page.locator("main")).toContainText("Done B");
      await expect.poll(() => selectedTitle(page)).toBe("Done B");

      await page.getByRole("button", { name: /Trash/ }).first().click();
      await start(page);
      // Gone R, then "Done A" (moved here above, the newest deletion), then Gone B.
      await walk(page, "ArrowDown", 3);
      expect(await selectedTitle(page)).toBe("Gone B");
      // 013 PRD Q187: in the Trash, Delete is Delete Permanently, which asks once in a dialog (no second press).
      await nextConfirm(app, false);
      await page.keyboard.press("Delete");
      await page.waitForTimeout(300);
      await expect(page.locator("main")).toContainText("Gone B");
      expect(await selectedTitle(page)).toBe("Gone B");
      await nextConfirm(app, true);
      await page.keyboard.press("Delete");
      await expect(page.locator("main")).not.toContainText("Gone B");
      await expect.poll(() => selectedTitle(page)).toBe("Gone A");
    } finally {
      await app.close();
    }
  });
});

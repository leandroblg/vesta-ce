/** 007 User Story 5: remapping (quickstart 20–23, 22a; US5-1 to US5-8; FR-031b, FR-033 to FR-037; T062). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rowLabel, shortcutGroups } from "../../src/domain/menu/groups";
import { actionById } from "../../src/domain/shortcuts/actions";
import { taskCard } from "./fixtures/alerts";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { IS_MAC, MOD, capture, dialog, openSettings } from "./fixtures/settings";

const row = (page: Page, action: string) => dialog(page).getByRole("row").filter({ has: page.getByRole("cell", { name: action, exact: true }) });
const status = (page: Page) => dialog(page).locator(".sc-status");
const NEW_TASK = "New Task";
/**
 * 013 FR-048 (analysis L1): every action in the table's order, grouped (Lists, then the menus); each row reads its
 * menu label without the ellipsis, in title case in English.
 */
function expectedRows(): string[] {
  const en = JSON.parse(readFileSync(join(import.meta.dirname, "../../src/shared/i18n/locales/en.json"), "utf8")) as Record<string, string>;
  return shortcutGroups(IS_MAC).flatMap((g) => g.actions.map((id) => rowLabel(en[actionById(id).labelKey] ?? id)));
}

/** A key-down as main forwards it while capturing (research §11), for keys a test must not press for real. */
async function forwarded(app: ElectronApplication, key: string, code: string, mod: boolean) {
  await app.evaluate(
    ({ BrowserWindow }, k) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("keys:captured", k);
    },
    { key, code, alt: false, shift: false, control: mod && process.platform !== "darwin", meta: mod && process.platform === "darwin" },
  );
}

const isMinimized = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() ?? false);

test.describe("007 US5 — remap keyboard shortcuts", () => {
  test("lists every action in order, with the platform's notation (US5-1)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Shortcuts");
      const names = await dialog(page).locator(".sc-table tr td:first-child").allTextContents();
      expect(names).toEqual(expectedRows());
      expect(names.slice(0, 3)).toEqual(["Select Previous", "Select Next", "Edit Title"]);
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText(IS_MAC ? "⌘N" : "Ctrl+N");
      await expect(row(page, "Move to Trash").locator("kbd")).toHaveText(["Delete", "Backspace"]);
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveAttribute("aria-label", IS_MAC ? "Command N" : "Control N");
    } finally {
      await app.close();
    }
  });

  test("refuses taken and reserved combinations with the reason, mapping unchanged (US5-5, US5-6, FR-034)", async () => {
    const { app, page } = await launchVesta();
    try {
      await capture(page, NEW_TASK, `${MOD}+z`);
      await expect(status(page)).toHaveText("Already used by Undo.");
      await page.keyboard.press("Tab");
      await expect(status(page)).toHaveText("Tab moves between controls, so it cannot be a shortcut.");
      await page.keyboard.press(`${MOD}+c`);
      // 013 FR-014: the refusal names the menu item that holds the combination.
      await expect(status(page)).toHaveText("Already used by Copy.");
      // Quit's combination, through main's forwarding path: pressing it for real could quit the app.
      await forwarded(app, "q", "KeyQ", true);
      await expect(status(page)).toHaveText(`Already used by ${process.platform === "darwin" ? "Quit Vesta" : "Quit"}.`);
      await page.keyboard.press("n");
      await expect(status(page)).toContainText("a single key would be typed as text.");
      await page.keyboard.press("Alt+n");
      await expect(status(page)).toContainText("This action works while typing");
      // Still capturing, and nothing changed; Esc twice ends it.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(status(page)).toHaveText("Shortcut not changed.");
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText(IS_MAC ? "⌘N" : "Ctrl+N");
    } finally {
      await app.close();
    }
  });

  test("F5 for New task works at once and after a restart; Mod+N stops; the empty card's hint follows; Reset restores (US5-2, US5-7, US5-8, SC-007)", async () => {
    const run = await launchVesta();
    let { app, page } = run;
    try {
      await capture(page, NEW_TASK, "F5");
      await expect(status(page)).toHaveText("New Task: F5");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await expect(page.getByTestId("empty-tasks")).toContainText("press F5 or type below.");
      await page.keyboard.press(`${MOD}+n`);
      await expect(page.getByRole("textbox", { name: "New task…" })).toHaveCount(0);
      await page.keyboard.press("F5");
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
      await page.keyboard.press("Escape");
      await app.close();

      ({ app, page } = await launchVesta({ dataDir: run.dataDir }));
      await page.keyboard.press("F5");
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
      await page.keyboard.press("Escape");
      await openSettings(page, "Shortcuts");
      await dialog(page).getByRole("button", { name: "Reset to defaults" }).click();
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText(IS_MAC ? "⌘N" : "Ctrl+N");
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toBeHidden();
      await page.keyboard.press(`${MOD}+n`);
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("the double Esc: twice cancels; once then 1 s assigns Esc; another key within 1 s is taken (US5-3, US5-4, FR-035)", async () => {
    const { app, page } = await launchVesta();
    try {
      const close = "Close Panel, Cancel Edit or Clear Selection";
      await capture(page, close, "F9");
      await expect(row(page, close).locator("kbd")).toHaveText("F9");
      await capture(page, close, "Escape");
      await page.waitForTimeout(1300);
      await expect(row(page, close).locator("kbd")).toHaveText("Esc");

      await capture(page, NEW_TASK, "Escape", "F6");
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText("F6");

      await capture(page, NEW_TASK, "Escape", "Escape");
      await expect(status(page)).toHaveText("Shortcut not changed.");
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText("F6");
    } finally {
      await app.close();
    }
  });

  test("a click elsewhere or a window blur ends the capture without change", async () => {
    const { app, page } = await launchVesta();
    try {
      await capture(page, NEW_TASK);
      await dialog(page).getByRole("heading", { name: "Keyboard shortcuts" }).click();
      await expect(dialog(page).getByText("Press keys…")).toHaveCount(0);
      await capture(page, NEW_TASK);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await forwarded(app, "F7", "F7", false);
      await expect(dialog(page).getByText("Press keys…")).toHaveCount(0);
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText(IS_MAC ? "⌘N" : "Ctrl+N");
    } finally {
      await app.close();
    }
  });

  test("Mod+Z and Mod+Shift+Z: Undo remapped, Mod+Z free for another action; editors keep text undo and redo; the menu follows (analysis I1, U3)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "First" }), task({ titleMd: "Second" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await capture(page, "Undo", `${MOD}+u`);
      await capture(page, NEW_TASK, `${MOD}+z`);
      await expect(row(page, NEW_TASK).locator("kbd")).toHaveText(IS_MAC ? "⌘Z" : "Ctrl+Z");
      await capture(page, "Settings", `${MOD}+Shift+z`);
      await expect(row(page, "Settings").locator("kbd")).toHaveText(IS_MAC ? "⇧⌘Z" : "Ctrl+Shift+Z");
      await page.keyboard.press("Escape");
      const undoAccel = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("undo")?.accelerator);
      expect(undoAccel).toBe("CmdOrCtrl+U");

      // Mod+Z no longer undoes the list; Mod+U does.
      await taskCard(page, "First").locator("[data-ctl='cb']").click();
      await expect(taskCard(page, "First")).toHaveCount(0);
      await page.locator("main").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press(`${MOD}+u`);
      await expect(taskCard(page, "First")).toBeVisible();

      // Outside editors Mod+Z is New task now; inside one it undoes typing, one step per press.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });
      await page.keyboard.press(`${MOD}+z`);
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
      await page.keyboard.press("Escape");

      await taskCard(page, "Second").locator(".title").dblclick();
      const editor = page.getByRole("textbox", { name: "Second" });
      await editor.press("End");
      for (const part of [" a", " b", " c"]) {
        await page.keyboard.type(part);
        await page.waitForTimeout(700);
      }
      await expect(editor).toHaveText("Second a b c");
      await page.keyboard.press(`${MOD}+z`);
      await expect(editor).toHaveText("Second a b");
      await page.keyboard.press(`${MOD}+Shift+z`);
      await expect(editor).toHaveText("Second a b c");
      await expect(dialog(page)).toBeHidden();
      await page.keyboard.press("Escape");

      // Outside editors Mod+Shift+Z opens Settings.
      await page.keyboard.press(`${MOD}+Shift+z`);
      await expect(dialog(page)).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("Minimize window: none by default on Windows and Linux, assignable; Cmd+M on macOS (quickstart 22a, FR-031b)", async () => {
    const { app, page } = await launchVesta();
    try {
      const min = "Minimize";
      if (IS_MAC) {
        await openSettings(page, "Shortcuts");
        await expect(row(page, min).locator("kbd")).toHaveText("⌘M");
        await page.keyboard.press("Escape");
        await page.keyboard.press("Meta+m");
        await expect.poll(() => isMinimized(app)).toBe(true);
        return;
      }
      await openSettings(page, "Shortcuts");
      await expect(row(page, min)).toContainText("None");
      await capture(page, min, "Control+m");
      await expect(row(page, min).locator("kbd")).toHaveText("Ctrl+M");
      const accel = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("minimize")?.accelerator);
      expect(accel).toBe("CmdOrCtrl+M");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+m");
      await expect.poll(() => isMinimized(app)).toBe(true);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.restore();
      });
      await openSettings(page, "Shortcuts");
      await dialog(page).getByRole("button", { name: "Reset to defaults" }).click();
      await expect(row(page, min)).toContainText("None");
    } finally {
      await app.close();
    }
  });
});

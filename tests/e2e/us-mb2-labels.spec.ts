// 013 US2 (spec scenarios 1–7; quickstart row 5): menu labels and shortcuts that follow the settings.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENUS, menuCommand, type MenuEntry } from "../../src/domain/menu/commands";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { menuItem, menuLabels, menuTitles } from "./fixtures/menu";
import { seedTasks, task } from "./fixtures/seed";
import { IS_MAC, MOD, capture, closeSettings, dialog, openSettings, setLanguage } from "./fixtures/settings";
import { nextConfirm } from "./fixtures/files";
import { readTask } from "./fixtures/clock";

const card = (page: Page, title: string) =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const status = (page: Page) => dialog(page).getByRole("status");

/** Every label the menus should show in a language, in menu order (the Develop menu of development builds added). */
function expectedLabels(lang: "en" | "pt-BR" | "it" | "es-ES" | "fr"): string[] {
  const table = JSON.parse(readFileSync(join(import.meta.dirname, `../../src/shared/i18n/locales/${lang}.json`), "utf8")) as Record<string, string>;
  const t = (key: string, params: Record<string, string> = {}) =>
    (table[key] ?? key).replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? `{${name}}`);
  const out: string[] = [];
  const walk = (entries: readonly MenuEntry[]) => {
    for (const e of entries) {
      if (e.kind === "separator") continue;
      if (e.kind === "role") out.push(t(e.labelKey));
      else if (e.kind === "submenu") {
        out.push(t(e.labelKey));
        walk(e.entries);
      } else {
        const c = menuCommand(e.id);
        const level = /^fmt:heading-(\d)$/.exec(e.id)?.[1];
        // 015 FR-010: Edit › Postpone For's items name their durations, at the defaults 1h, 2h, 4h and 6h.
        if (c.duration !== undefined) out.push(`${String([1, 2, 4, 6][c.duration] ?? 0)}${t("unitH")}`);
        else out.push(level !== undefined && level !== "0" ? t(c.labelKey, { n: level }) : t(c.labelKey));
      }
    }
  };
  for (const menu of MENUS(IS_MAC)) {
    if (menu.id === "window") out.push(t("menuDevelop"), t("menuReload"), t("menuForceReload"), t("menuDevTools"));
    out.push(t(menu.labelKey));
    walk(menu.entries);
  }
  return out;
}

async function launch() {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Fix bike", position: 1 })]);
  return launchVesta({ dataDir });
}

test.describe("013 US2 — menu labels and shortcuts that follow my settings", () => {
  test("US2-1 US2-2 a remapped New task shows on File › New Task and the old key does nothing; Minimize shows nothing outside macOS", async () => {
    const { app, page } = await launch();
    try {
      expect((await menuItem(app, "newTask")).accelerator).toBe("CmdOrCtrl+N");
      await capture(page, "New Task", `${MOD}+t`);
      await expect(status(page)).toContainText("T");
      await closeSettings(page);
      await expect.poll(async () => (await menuItem(app, "newTask")).accelerator).toBe("CmdOrCtrl+T");
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press(`${MOD}+n`);
      await page.waitForTimeout(300);
      await expect(page.getByRole("textbox", { name: "New task…" })).toHaveCount(0);
      await page.keyboard.press(`${MOD}+t`);
      await expect(page.getByRole("textbox", { name: "New task…" })).toBeFocused();
      if (!IS_MAC) expect((await menuItem(app, "minimize")).accelerator).toBeNull();
    } finally {
      await app.close();
    }
  });

  test("US2-3 every menu label follows each of the five languages", async () => {
    const { app, page } = await launch();
    try {
      for (const [value, lang] of [
        ["pt-BR", "pt-BR"],
        ["it", "it"],
        ["es-ES", "es-ES"],
        ["fr", "fr"],
        ["en", "en"],
      ] as const) {
        await setLanguage(page, value, lang);
        await expect.poll(() => menuLabels(app), { message: lang }).toEqual(expectedLabels(lang));
      }
      expect(await menuTitles(app)).toContain("Format");
    } finally {
      await app.close();
    }
  });

  test("US2-4 English title case and ellipses on the items that open a dialog or window", async () => {
    const { app } = await launch();
    try {
      expect((await menuItem(app, "done")).label).toBe("Mark as Done");
      expect((await menuItem(app, "trash")).label).toBe("Move to Trash");
      for (const id of ["settings", "alertPeriod", "export", "import", "deleteForever", "fmt:link"]) expect((await menuItem(app, id)).label, id).toMatch(/…$/);
      expect((await menuItem(app, "done")).label).not.toMatch(/…$/);
    } finally {
      await app.close();
    }
  });

  test("US2-5 the context menu, the menu bar and the toolbar share their labels", async () => {
    const { app, page } = await launch();
    try {
      await clickRevealed(card(page, "Fix bike"), card(page, "Fix bike").getByRole("button", { name: "More actions" }));
      const items = await page.getByRole("menuitem").allTextContents();
      expect(items.map((s) => s.trim())).toEqual(["New Subtask", "Show Details", "Reschedule", "Postpone For", "Alert Period…", "Move to Trash"]);
      for (const [label, id] of [
        ["New Subtask", "newSub"],
        ["Show Details", "showDetails"],
        ["Alert Period…", "alertPeriod"],
        ["Move to Trash", "trash"],
      ] as const)
        expect((await menuItem(app, id)).label).toBe(label);
      await page.keyboard.press("Escape");
      const nav = page.locator("header nav");
      await expect(nav.getByRole("button", { name: /^Archive/ }).locator(".lbl")).toHaveText((await menuItem(app, "view:archive")).label);
      await expect(nav.getByRole("button", { name: /^Trash/ }).locator(".lbl")).toHaveText((await menuItem(app, "view:trash")).label);
    } finally {
      await app.close();
    }
  });

  test("US2-6 a combination the menu registers is refused, naming the action", async () => {
    const { app, page } = await launch();
    try {
      await capture(page, "New Task", `${MOD}+Comma`);
      await expect(status(page)).toHaveText("Already used by Settings.");
      await capture(page, "New Task", `${MOD}+q`);
      await expect(status(page)).toHaveText(`Already used by ${process.platform === "darwin" ? "Quit Vesta" : "Quit"}.`);
    } finally {
      await app.close();
    }
  });

  test("US2-7 in the details editor, Mod+B and Mod+Z reach the editor although the menu shows them", async () => {
    const { app, page } = await launch();
    try {
      await card(page, "Fix bike").locator(".title").click();
      const editor = page.getByRole("textbox", { name: "Details" });
      await editor.click();
      await page.keyboard.type("hello");
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.press(`${MOD}+b`);
      await expect(editor.locator("strong")).toHaveText("hello");
      await page.keyboard.press(`${MOD}+z`);
      await expect(editor.locator("strong")).toHaveCount(0);
      expect((await menuItem(app, "fmt:strong")).accelerator).toBe("CmdOrCtrl+B");
    } finally {
      await app.close();
    }
  });

  test("FR-048 Cmd/Ctrl+1, 2 and 3 switch views; Delete Permanently's keys ask in the Trash; an assigned Underline key works and shows; Bold has no row", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const bike = task({ titleMd: "Fix bike", position: 1 });
    seedTasks(dataDir, [bike, task({ titleMd: "Old idea", position: 2, deletedAt: now - 1000 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.locator("#search").focus();
      await page.keyboard.press("Escape");
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press(`${MOD}+3`);
      await expect(page.locator("header nav").getByRole("button", { name: /^Trash/ })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press(`${MOD}+2`);
      await expect(page.locator("header nav").getByRole("button", { name: /^Archive/ })).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press(`${MOD}+3`);
      await page.locator("li.arow[data-id]").first().focus();
      await nextConfirm(app, false);
      await page.keyboard.press(IS_MAC ? "Meta+Alt+Backspace" : "Shift+Delete");
      await page.waitForTimeout(300);
      await expect(page.locator("li.arow[data-id]")).toHaveCount(1);
      await nextConfirm(app, true);
      await page.keyboard.press("Delete");
      await expect(page.locator("li.arow[data-id]")).toHaveCount(0);
      await page.keyboard.press(`${MOD}+1`);
      await expect(page.locator("header nav button[aria-pressed='true']")).toHaveCount(0);

      await capture(page, "Underline", "Control+Alt+u");
      await closeSettings(page);
      await expect.poll(async () => (await menuItem(app, "fmt:underline")).accelerator).toMatch(/Alt\+U$/);
      await openSettings(page, "Shortcuts");
      await expect(dialog(page).getByRole("cell", { name: "Bold", exact: true })).toHaveCount(0);
      await closeSettings(page);
      await card(page, "Fix bike").locator(".title").click();
      const details = page.getByRole("complementary", { name: "Details" }).getByRole("textbox", { name: "Details" });
      await details.click();
      await page.keyboard.type("word");
      await page.keyboard.press(`${MOD}+a`);
      await page.keyboard.press("Control+Alt+u");
      await expect.poll(() => readTask(dataDir, bike.id)?.details_md ?? "").toMatch(/underline/);
      await page.keyboard.press(`${MOD}+b`);
      await expect(details.locator("strong")).toHaveText("word");
    } finally {
      await app.close();
    }
  });
});


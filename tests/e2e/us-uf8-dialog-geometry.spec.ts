/**
 * 016 User Story 9: About as tall as its content, Settings' height following the pane, Logs centered at 80 %, and the
 * dialog heads' move and resize keys (FR-035 to FR-039, SC-008; PRD Q224, Q236, Q239, Q244, Q246, Q252, Q254, Q258;
 * ui.md "Settings dialog", "Log viewer", "About").
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu } from "./fixtures/menu";
import { seedTasks, task } from "./fixtures/seed";
import { openSettings, setLanguage, showPane } from "./fixtures/settings";

const LANGUAGES = [
  ["en", "en"],
  ["pt-BR", "pt-BR"],
  ["it", "it"],
  ["es-ES", "es-ES"],
  ["fr", "fr"],
] as const;

const settings = (page: Page) => page.locator("dialog.settings-dialog:not(.log-dialog)[open]");
const logs = (page: Page) => page.locator("dialog.log-dialog[open]");
const about = (page: Page) => page.getByTestId("about-dialog");
const near = (a: number, b: number, by = 1) => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(by);
};

async function resize(app: ElectronApplication, page: Page, w: number, h: number): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.w, size.h);
    },
    { w, h },
  );
  await page
    .waitForFunction((size) => window.innerWidth === size.w && window.innerHeight === size.h, { w, h }, { timeout: 5000 })
    .catch(async () => {
      throw new Error(`window is ${JSON.stringify(await page.evaluate(() => [window.innerWidth, window.innerHeight]))}`);
    });
}

async function box(el: Locator) {
  const b = await el.boundingBox();
  if (b === null) throw new Error("no box");
  return b;
}

async function openLogs(page: Page): Promise<void> {
  await showPane(page, "Data");
  await settings(page).getByTestId("logs-open").click();
  await expect(logs(page)).toBeVisible();
}

async function dragBy(page: Page, from: Locator, dx: number, dy: number, at: { x: number; y: number } | null = null): Promise<void> {
  const b = await box(from);
  const x = b.x + (at?.x ?? b.width / 2);
  const y = b.y + (at?.y ?? b.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 5 });
  await page.mouse.up();
}

/** About's space above the icon and below the footnote, in CSS px. */
function aboutMargins(page: Page): Promise<{ above: number; below: number; height: number; scrolls: boolean }> {
  return about(page).evaluate((d) => {
    const icon = d.querySelector(".about-card svg, .about-card .app-icon") as Element;
    // 018 FR-023: the footnote has two lines; the space is measured below the last one.
    const feet = d.querySelectorAll(".about-footnote");
    const foot = feet[feet.length - 1] as Element;
    const card = d.querySelector(".about-card") as HTMLElement;
    const r = d.getBoundingClientRect();
    return {
      above: icon.getBoundingClientRect().top - r.top,
      below: r.bottom - foot.getBoundingClientRect().bottom,
      height: r.height,
      scrolls: card.scrollHeight > card.clientHeight + 1,
    };
  });
}

test.describe("016 US9 — dialog geometry", () => {
  test("About: the space below the footnote equals the space above the icon in five languages; at 360 × 420 it stays within 70 % and scrolls; the license views too", async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchVesta();
    try {
      await resize(app, page, 1000, 800);
      for (const [value, lang] of LANGUAGES) {
        await setLanguage(page, value, lang);
        await page.keyboard.press("Escape");
        await clickMenu(app, "about");
        await expect(about(page)).toBeVisible();
        const m = await aboutMargins(page);
        expect(m.above, lang).toBeGreaterThan(0);
        near(m.below, m.above);
        expect(m.scrolls, lang).toBe(false);
        await page.keyboard.press("Escape");
        await expect(about(page)).toBeHidden();
      }
      await setLanguage(page, "en", "en");
      await page.keyboard.press("Escape");

      await resize(app, page, 360, 420);
      await clickMenu(app, "about");
      const small = await aboutMargins(page);
      expect(small.height).toBeLessThanOrEqual(0.7 * 420 + 1);
      expect(small.scrolls).toBe(true);
      for (const name of ["License", "Third-Party Licenses"]) {
        await about(page).getByRole("button", { name, exact: true }).click();
        const b = await box(about(page));
        expect(b.height).toBeLessThanOrEqual(0.7 * 420 + 1);
        // The license scrolls; the third-party notices are one line until feature 017 bundles them.
        if (name === "License") expect(await about(page).locator(".about-license-text").evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
        await page.keyboard.press("Escape");
      }
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("Settings: the toolbar keeps its top on General and Shortcuts in five languages, General is shorter; Logs opens centered at 80 %", async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchVesta();
    try {
      await resize(app, page, 1200, 800);
      for (const [value, lang] of LANGUAGES) {
        await setLanguage(page, value, lang);
        await showPane(page, "General");
        const general = await box(settings(page));
        const tabsG = await box(settings(page).locator(".set-tabs"));
        await showPane(page, "Shortcuts");
        const shortcuts = await box(settings(page));
        const tabsS = await box(settings(page).locator(".set-tabs"));
        near(tabsG.y, tabsS.y);
        near(general.y, 160);
        expect(general.height, lang).toBeLessThan(shortcuts.height);
        await openLogs(page);
        const l = await box(logs(page));
        near(l.width, 960);
        near(l.height, 640);
        near(l.x, 120);
        near(l.y, 80);
        await page.keyboard.press("Escape");
        await expect(logs(page)).toHaveCount(0);
      }
    } finally {
      await app.close();
    }
  });

  test("Settings: a hand resize holds across panes until it closes; Logs: dragged by its head (not its controls), resized from an edge and a corner, never under 360 × 320, reopened at 80 %", async () => {
    const { app, page } = await launchVesta();
    try {
      await resize(app, page, 1200, 800);
      await openSettings(page, "General");
      await dragBy(page, settings(page).locator(".rz.se"), 40, 30);
      const held = await box(settings(page));
      await showPane(page, "Shortcuts");
      const after = await box(settings(page));
      near(after.width, held.width);
      near(after.height, held.height);

      await openLogs(page);
      const head = logs(page).locator(".modal-head");
      // The level control (its label; a press on the select opens its native popup) never starts a move.
      await dragBy(page, logs(page).locator(".lv-select"), 60, 40, { x: 4, y: 6 });
      let r = await box(logs(page));
      near(r.x, 120);
      near(r.y, 80);
      await expect(logs(page)).toBeVisible();
      await dragBy(page, head, -50, -30, { x: 120, y: 12 });
      r = await box(logs(page));
      near(r.x, 70);
      near(r.y, 50);
      await dragBy(page, logs(page).locator(".rz.e"), -100, 0);
      r = await box(logs(page));
      near(r.width, 860);
      await dragBy(page, logs(page).locator(".rz.se"), -2000, -2000);
      r = await box(logs(page));
      near(r.width, 360);
      near(r.height, 320);
      await logs(page).getByRole("button", { name: "Close" }).click();
      await expect(logs(page)).toHaveCount(0);
      await openLogs(page);
      r = await box(logs(page));
      near(r.width, 960);
      near(r.x, 120);
    } finally {
      await app.close();
    }
  });

  test("the focused head moves the dialog 10 px with an arrow and resizes it with Shift; a tab, the level select and Alt+Up keep their own behaviour", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "First", position: 1 }), task({ titleMd: "Second", position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await resize(app, page, 1200, 800);
      await openSettings(page, "General");
      const head = settings(page).locator(".modal-head");
      await head.focus();
      await expect(head).toHaveAccessibleDescription("Arrow keys move this window; Shift+arrow keys resize it.");
      let before = await box(settings(page));
      await page.keyboard.press("ArrowRight");
      let r = await box(settings(page));
      near(r.x, before.x + 10);
      near(r.y, before.y);
      before = r;
      await page.keyboard.press("Shift+ArrowDown");
      r = await box(settings(page));
      near(r.height, before.height + 10);
      near(r.y, before.y);
      // Alt+Up on the head moves no task (it is the list's Move Up).
      await page.keyboard.press("Alt+ArrowUp");
      await expect(page.locator("li[data-kind='task'] .title").first()).toHaveText("First");
      // On a pane tab the arrows move between tabs, not the dialog.
      before = await box(settings(page));
      await settings(page).locator('[role="tab"][data-pane="general"]').focus();
      await page.keyboard.press("ArrowRight");
      r = await box(settings(page));
      near(r.x, before.x);

      await openLogs(page);
      const lhead = logs(page).locator(".modal-head");
      await lhead.focus();
      await expect(lhead).toHaveAccessibleDescription("Arrow keys move this window; Shift+arrow keys resize it.");
      const lb = await box(logs(page));
      await page.keyboard.press("ArrowLeft");
      near((await box(logs(page))).x, lb.x - 10);
      await page.keyboard.press("Shift+ArrowUp");
      near((await box(logs(page))).height, lb.height - 10);
      const before2 = await box(logs(page));
      // (ArrowDown on a focused select opens its native popup on macOS, which a test cannot close.)
      await logs(page).getByTestId("log-level").focus();
      await page.keyboard.press("ArrowRight");
      near((await box(logs(page))).y, before2.y);
      await expect(taskCard(page, "First")).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test("shrinking the window keeps Settings and Logs inside it and at least 360 × 320; at 360 × 420 every dialog fits", async () => {
    const { app, page } = await launchVesta();
    try {
      await resize(app, page, 1200, 800);
      await openSettings(page, "General");
      await dragBy(page, settings(page).locator(".modal-head"), 300, 200, { x: 8, y: 8 });
      await resize(app, page, 700, 500);
      let r = await box(settings(page));
      expect(r.x + r.width).toBeLessThanOrEqual(700 + 1);
      expect(r.y + r.height).toBeLessThanOrEqual(500 + 1);
      expect(r.width).toBeGreaterThanOrEqual(360 - 1);
      expect(r.height).toBeGreaterThanOrEqual(320 - 1);

      await resize(app, page, 1200, 800);
      await openLogs(page);
      // The window's own minimum is 360 × 420.
      await resize(app, page, 500, 420);
      r = await box(logs(page));
      expect(r.x).toBeGreaterThanOrEqual(-1);
      expect(r.x + r.width).toBeLessThanOrEqual(500 + 1);
      expect(r.y + r.height).toBeLessThanOrEqual(420 + 1);
      expect(r.width).toBeGreaterThanOrEqual(360 - 1);
      expect(r.height).toBeGreaterThanOrEqual(320 - 1);

      await resize(app, page, 360, 420);
      for (const d of [settings(page), logs(page)]) {
        const b = await box(d);
        expect(b.x).toBeGreaterThanOrEqual(-1);
        expect(b.y).toBeGreaterThanOrEqual(-1);
        expect(b.x + b.width).toBeLessThanOrEqual(360 + 1);
        expect(b.y + b.height).toBeLessThanOrEqual(420 + 1);
      }
      // Every control of the log head is reachable.
      await expect(logs(page).getByTestId("log-level")).toBeInViewport();
      await expect(logs(page).getByRole("button", { name: "Close" })).toBeInViewport();
    } finally {
      await app.close();
    }
  });
});

/** 007 accessibility (quickstart 26, 27; FR-040; SC-001, SC-008; T067). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { tick } from "./fixtures/clock";
import { expectNoA11yViolations } from "./fixtures/axe";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";
import { searchBox } from "./fixtures/search";
import { MOD, openSettings, showPane } from "./fixtures/settings";

const settings = (page: Page) => page.locator("dialog.settings-dialog[open]");

function seed(dataDir: string) {
  seedTasks(dataDir, [staleTask({ titleMd: "Old one", position: 1 }), task({ titleMd: "Fresh", position: 2 })]);
  seedReminders(dataDir, [reminder({ textMd: "Call the bank" })]);
}

/** 013 Q166: the selected card is drawn as a filled accent row; true when the card's background is the theme's accent. */
const filled = (page: Page, title: string) =>
  taskCard(page, title).evaluate((li) => {
    const probe = document.createElement("div");
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue("--accent");
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(li).backgroundColor === accent;
  });

test.describe("007 accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe: Settings (an error, a capture) and the main view with a selection, ${colorScheme} (FR-040, SC-008)`, async () => {
      const dataDir = freshDataDir();
      seed(dataDir);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.emulateMedia({ colorScheme });
        await tick(page);
        await page.keyboard.press("ArrowDown");
        await expectNoA11yViolations(page, `main view with a selection, ${colorScheme}`);
        await openSettings(page, "Alerts");
        // 016 FR-031: an over-maximum value is clamped; a value under the minimum still shows its error.
        await settings(page).getByRole("group", { name: "Re-blink interval" }).getByRole("spinbutton", { name: "Hours" }).fill("0");
        await expect(settings(page)).toContainText("Allowed range");
        await expectNoA11yViolations(page, `Settings with an error, ${colorScheme}`);
        await showPane(page, "Shortcuts");
        await settings(page).getByRole("button", { name: "Change shortcut for New task" }).click();
        await expectNoA11yViolations(page, `Settings during a capture, ${colorScheme}`);
      } finally {
        await app.close();
      }
    });
  }

  for (const colorScheme of ["light", "dark"] as const) {
    test(`018 axe: the Data pane's cleanups with a countdown, and the Archive with its Delete buttons, ${colorScheme} (T065)`, async () => {
      const dataDir = freshDataDir();
      seedTasks(dataDir, [task({ titleMd: "Done one", doneAt: Date.now() - DAY, updatedAt: Date.now() - DAY })]);
      seedReminders(dataDir, [reminder({ textMd: "Done reminder", doneAt: Date.now() - DAY })]);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.emulateMedia({ colorScheme });
        await openSettings(page, "Data");
        const trash = settings(page).getByTestId("cleanup-trash");
        // Each group is named by its legend; a longer time saves on Enter without a dialog and starts the countdown.
        await expect(trash.getByRole("group", { name: "Trash", exact: true }).first()).toBeVisible();
        await trash.getByRole("spinbutton", { name: "Days" }).fill("60");
        await page.keyboard.press("Enter");
        const countdown = trash.getByTestId("cleanup-trash-countdown");
        await expect(countdown).toBeVisible();
        // The countdown changes every second, so it is not a live region.
        expect(await countdown.evaluate((el) => el.closest("[aria-live]:not([aria-live='off']), [role='status'], [role='timer']") === null)).toBe(true);
        await expectNoA11yViolations(page, `Settings → Data with a countdown, ${colorScheme}`);
        await page.keyboard.press("Escape");
        await expect(settings(page)).toBeHidden();
        await page.getByRole("button", { name: /^Archive/ }).click();
        await expect(page.getByRole("button", { name: "Delete “Done one”" })).toBeVisible();
        await expectNoA11yViolations(page, `the Archive with its Delete buttons, ${colorScheme}`);
      } finally {
        await app.close();
      }
    });
  }

  for (const lang of ["pt-BR", "it", "es-ES", "fr"]) {
    test(`axe: Settings in ${lang}`, async () => {
      const { app, page } = await launchVesta({ env: { VESTA_TEST_OS_LANGS: lang } });
      try {
        await page.keyboard.press(`${MOD}+Comma`);
        await expect(settings(page)).toBeVisible();
        await expectNoA11yViolations(page, `Settings in ${lang}`);
      } finally {
        await app.close();
      }
    });
  }

  test("Tab reaches every Settings control, each with a name (FR-040, SC-001)", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "General");
      // The visible pane's Tab stops: the other panes are hidden until their tab is chosen, and the tab strip is one stop.
      const controls = await settings(page)
        .locator("input, select, button")
        .evaluateAll((els) => els.filter((e) => e.closest("[hidden]") === null && (e as HTMLElement).tabIndex >= 0).length);
      const seen = new Set<string>();
      for (let i = 0; i < controls + 5; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (el === null || el.closest("dialog") === null) return null;
          const name = el.getAttribute("aria-label") ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent;
          const index = Array.from(document.querySelectorAll("dialog input, dialog select, dialog button")).filter((e) => e.closest("[hidden]") === null).indexOf(el);
          return { id: String(index), name: name.trim() };
        });
        expect(info, "focus stays in the dialog").not.toBeNull();
        if (info !== null) {
          expect(info.name.length, info.id).toBeGreaterThan(0);
          seen.add(info.id);
        }
      }
      // Every control but the two radios not checked (a radio group is one Tab stop).
      expect(seen.size).toBeGreaterThanOrEqual(controls - 2);
    } finally {
      await app.close();
    }
  });

  test("the selection is visible on a stale, a hovered and a search-highlighted card (research §14; 013 Q166 accent fill)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => filled(page, "Old one")).toBe(true);
      await taskCard(page, "Old one").hover();
      expect(await filled(page, "Old one")).toBe(true);
      await searchBox(page).fill("Fresh");
      await taskCard(page, "Fresh").locator("[data-ctl='cb']").focus();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowDown");
      await expect.poll(() => filled(page, "Fresh")).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("French at 360 px: no horizontal overflow in the header, the context menu and Settings; names stay whole (quickstart 27)", async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_TEST_OS_LANGS: "fr-FR" } });
    try {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(360, 700);
      });
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(360);
      const overflow = (selector: string) =>
        page.evaluate((s) => {
          const el = document.querySelector(s);
          return el === null ? 0 : el.scrollWidth - el.clientWidth;
        }, selector);
      expect(await overflow("header")).toBeLessThanOrEqual(0);
      await expect(page.getByRole("button", { name: /^Archives/ })).toBeVisible();
      const card = taskCard(page, "Fresh");
      await card.hover();
      await card.getByRole("button", { name: "Plus d'actions" }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
      await page.keyboard.press("Escape");
      await page.keyboard.press(`${MOD}+Comma`);
      await expect(settings(page)).toBeVisible();
      expect(await overflow("dialog.settings-dialog .modal-body")).toBeLessThanOrEqual(0);
    } finally {
      await app.close();
    }
  });
});

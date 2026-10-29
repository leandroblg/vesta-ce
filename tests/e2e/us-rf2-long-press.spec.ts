/**
 * 015 User Story 2: the quick reschedule durations from the hold, Shift+Enter, the context menu's Postpone For row
 * and Edit › Postpone For (FR-006 to FR-011, FR-010a to FR-010c, SC-001, SC-003; PRD Q207, Q209, Q220–Q222;
 * ui.md "Card context menu", "Durations menu").
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, waitMenuState } from "./fixtures/menu";
import { seedTasks, task } from "./fixtures/seed";

const ago = (ms: number) => Date.now() - ms;
const durations = (page: Page) => page.getByRole("menu", { name: "Postpone For" });
const reschedButton = (card: Locator) => card.locator(".act.resched");

async function launch(rows: ReturnType<typeof task>[]) {
  const dataDir = freshDataDir();
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir });
  await tick(launched.page);
  await waitBlinksDone(launched.page);
  return { ...launched, dataDir };
}

/** Presses the primary button on `target` for `ms`, then releases it there. */
async function hold(page: Page, target: Locator, ms = 650) {
  const b = await target.boundingBox();
  if (b === null) throw new Error("no box");
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function idOf(card: Locator): Promise<string> {
  return (await card.getAttribute("data-id")) ?? "";
}

/** The row is one line of four items, below the button, centered under it unless the right margin is short. */
async function expectRowUnder(page: Page, button: Locator) {
  const row = durations(page);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-orientation", "horizontal");
  const items = row.getByRole("menuitem");
  await expect(items).toHaveText(["1h", "2h", "4h", "6h"]);
  const tops = await items.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const b = (await button.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const r = (await row.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const view = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
  expect(r.y).toBeGreaterThanOrEqual(b.y + b.height);
  const centered = b.x + b.width / 2 - r.width / 2;
  if (centered + r.width <= view.width - 8) expect(Math.abs(r.x + r.width / 2 - (b.x + b.width / 2))).toBeLessThanOrEqual(1);
  else expect(Math.abs(r.x + r.width - (view.width - 8))).toBeLessThanOrEqual(1);
}

test.describe("015 US2 — quick reschedule durations", () => {
  test("holding the hover button opens the four durations below it; 2h makes the task stale 2 h later (scenarios 1, 2)", async () => {
    const { app, page, dataDir } = await launch([task({ titleMd: "Old", position: 1, createdAt: ago(30 * HOUR) })]);
    try {
      const card = taskCard(page, "Old");
      const id = await idOf(card);
      await hold(page, reschedButton(card));
      await expectRowUnder(page, reschedButton(card));
      await expect(card).toHaveClass(/\bstale\b/);
      await durations(page).getByRole("menuitem", { name: "2h" }).click();
      await expect(card).not.toHaveClass(/\bstale\b/);
      await expect.poll(() => readTask(dataDir, id)?.reschedule_for_min).toBe(120);
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

  test("Esc and a click outside close the row with no change; a short press uses the tolerance; leaving early does nothing (scenarios 3, 4)", async () => {
    const { app, page, dataDir } = await launch([
      task({ titleMd: "Old", position: 1, createdAt: ago(30 * HOUR) }),
      task({ titleMd: "Older", position: 2, createdAt: ago(40 * HOUR) }),
    ]);
    try {
      const card = taskCard(page, "Old");
      await hold(page, reschedButton(card));
      await expect(durations(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(durations(page)).toHaveCount(0);
      await expect(reschedButton(card)).toBeFocused();
      await expect(card).toHaveClass(/\bstale\b/);

      await hold(page, reschedButton(card));
      await page.mouse.click(5, 300);
      await expect(durations(page)).toHaveCount(0);
      await expect(card).toHaveClass(/\bstale\b/);

      // Leaving the button before 500 ms: neither a reschedule nor a row.
      const b = (await reschedButton(card).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);
      await page.mouse.move(5, 300);
      await page.waitForTimeout(500);
      await page.mouse.up();
      await expect(durations(page)).toHaveCount(0);
      await expect(card).toHaveClass(/\bstale\b/);

      const older = taskCard(page, "Older");
      const id = await idOf(older);
      await hold(page, reschedButton(older), 150);
      await expect(durations(page)).toHaveCount(0);
      await expect(older).not.toHaveClass(/\bstale\b/);
      expect(readTask(dataDir, id)?.reschedule_for_min).toBeNull();
    } finally {
      await app.close();
    }
  });

  test("Shift+Enter opens the row on its first item; Right moves; Enter on the button uses the tolerance (scenario 7)", async () => {
    const { app, page, dataDir } = await launch([
      task({ titleMd: "Old", position: 1, createdAt: ago(30 * HOUR) }),
      task({ titleMd: "Older", position: 2, createdAt: ago(40 * HOUR) }),
    ]);
    try {
      const card = taskCard(page, "Old");
      const cardId = await idOf(card);
      await card.getByRole("checkbox").focus();
      await page.keyboard.press("Tab");
      await expect(reschedButton(card)).toBeFocused();
      await page.keyboard.press("Shift+Enter");
      await expect(durations(page).getByRole("menuitem", { name: "1h" })).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await expect(durations(page).getByRole("menuitem", { name: "4h" })).toBeFocused();
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowRight");
      await expect(durations(page).getByRole("menuitem", { name: "6h" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => readTask(dataDir, cardId)?.reschedule_for_min).toBe(360);
      await expect(card).not.toHaveClass(/\bstale\b/);

      const older = taskCard(page, "Older");
      const id = await idOf(older);
      await older.getByRole("checkbox").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(older).not.toHaveClass(/\bstale\b/);
      expect(readTask(dataDir, id)?.reschedule_for_min).toBeNull();
    } finally {
      await app.close();
    }
  });

  test("the details panel's Reschedule button holds like the hover button and is absent on a task that is not stale (scenario 6)", async () => {
    const { app, page, dataDir } = await launch([
      task({ titleMd: "Old", position: 1, createdAt: ago(30 * HOUR) }),
      task({ titleMd: "Fresh", position: 2, createdAt: ago(HOUR) }),
    ]);
    try {
      await taskCard(page, "Fresh").locator(".title").click();
      await expect(page.locator(".panel-resched")).toHaveCount(0);
      const card = taskCard(page, "Old");
      const id = await idOf(card);
      await card.locator(".title").click();
      const button = page.locator(".panel-resched");
      await expect(button).toBeVisible();
      await hold(page, button);
      await expectRowUnder(page, button);
      await durations(page).getByRole("menuitem", { name: "4h" }).click();
      await expect.poll(() => readTask(dataDir, id)?.reschedule_for_min).toBe(240);
    } finally {
      await app.close();
    }
  });

  test("the context menu stays right-aligned to “…”; Postpone For opens the row on its left, level with it, the menu not moving (scenario 5)", async () => {
    const { app, page, dataDir } = await launch([
      task({ titleMd: "Fresh", position: 1, createdAt: ago(HOUR) }),
      task({ titleMd: "Other", position: 2, createdAt: ago(HOUR) }),
    ]);
    try {
      const card = taskCard(page, "Fresh");
      const id = await idOf(card);
      const cardsBefore = await page.locator("li[data-kind='task']").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
      const more = card.getByRole("button", { name: "More actions" });
      await clickRevealed(card, more);
      const menu = page.getByRole("menu", { name: /Fresh/ });
      const m = (await menu.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const b = (await more.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      expect(Math.abs(m.x + m.width - (b.x + b.width))).toBeLessThanOrEqual(1);
      expect(m.y).toBeGreaterThanOrEqual(b.y + b.height);
      const cardsOpen = await page.locator("li[data-kind='task']").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
      expect(cardsOpen).toEqual(cardsBefore);

      const postpone = page.getByRole("menuitem", { name: "Postpone For" });
      await expect(postpone).toHaveAttribute("aria-haspopup", "menu");
      for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowDown");
      await expect(postpone).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(durations(page).getByRole("menuitem", { name: "1h" })).toBeFocused();
      await expect(postpone).toHaveAttribute("aria-expanded", "true");
      const row = (await durations(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const item = (await postpone.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      expect(row.x + row.width).toBeLessThanOrEqual(m.x);
      expect(Math.abs(row.y + row.height / 2 - (item.y + item.height / 2))).toBeLessThanOrEqual(1);
      expect((await menu.boundingBox())?.x).toBe(m.x);

      // Right on the last item, or Esc, goes back to Postpone For.
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowRight");
      await expect(postpone).toBeFocused();
      await expect(durations(page)).toHaveCount(0);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowRight");
      await expect(durations(page).getByRole("menuitem", { name: "2h" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(menu).toHaveCount(0);
      await expect.poll(() => readTask(dataDir, id)?.reschedule_for_min).toBe(120);
    } finally {
      await app.close();
    }
  });

  test("Edit › Postpone For › 4h and the hold row's 4h give the same stale moment (SC-001)", async () => {
    const { app, page, dataDir } = await launch([
      task({ titleMd: "By menu", position: 1, createdAt: ago(30 * HOUR) }),
      task({ titleMd: "By hold", position: 2, createdAt: ago(30 * HOUR) }),
    ]);
    try {
      const byMenu = taskCard(page, "By menu");
      const byHold = taskCard(page, "By hold");
      await byMenu.locator('[data-ctl="cb"]').focus();
      await waitMenuState(app, "postponeFor3", { enabled: true });
      await clickMenu(app, "postponeFor3");
      await hold(page, reschedButton(byHold));
      await durations(page).getByRole("menuitem", { name: "4h" }).click();
      const a = await idOf(byMenu);
      const b = await idOf(byHold);
      await expect.poll(() => readTask(dataDir, a)?.reschedule_for_min).toBe(240);
      await expect.poll(() => readTask(dataDir, b)?.reschedule_for_min).toBe(240);
      const baseA = readTask(dataDir, a)?.stale_base_at ?? 0;
      const baseB = readTask(dataDir, b)?.stale_base_at ?? 0;
      await advanceClock(app, 4 * HOUR - MIN);
      await tick(page);
      await expect(byMenu).not.toHaveClass(/\bstale\b/);
      await expect(byHold).not.toHaveClass(/\bstale\b/);
      await advanceClock(app, 2 * MIN + Math.abs(baseA - baseB));
      await tick(page);
      await expect(byMenu).toHaveClass(/\bstale\b/);
      await expect(byHold).toHaveClass(/\bstale\b/);
      expect(readTask(dataDir, a)?.stale_since).toBe(baseA + 4 * HOUR);
      expect(readTask(dataDir, b)?.stale_since).toBe(baseB + 4 * HOUR);
    } finally {
      await app.close();
    }
  });
});

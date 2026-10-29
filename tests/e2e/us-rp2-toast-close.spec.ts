// 018 US5 (FR-006 to FR-008, SC-002; PRD Q271): on every notification kind the close button floats over the upper
// right corner, shown on hover or focus, reserving no space, covering no text or button, reached with Tab.
import { expect, test, type Page } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";

const toast = (page: Page) => page.getByTestId("notification");

const KINDS: { name: string; event: Record<string, unknown> }[] = [
  { name: "undo (done)", event: { type: "showUndo", kind: "done", token: "t1", title: "Fix bike" } },
  { name: "redo", event: { type: "showRedo", token: "t2", title: "Fix bike" } },
  { name: "Undo import", event: { type: "showImportUndo", token: "t3", counts: { added: 2, updated: 1, unchanged: 0 }, deadline: Date.now() + 600_000 } },
  { name: "update", event: { type: "showUpdate", version: "9.9.9" } },
  { name: "reminder", event: { type: "showReminder" } },
  { name: "saveFailed", event: { type: "showSticky", kind: "saveFailed" } },
  { name: "abnormalExit", event: { type: "showSticky", kind: "abnormalExit", at: Date.now() - 60_000 } },
  { name: "backupRestored", event: { type: "showSticky", kind: "backupRestored", backupAt: Date.now() - 3_600_000, moved: null } },
  { name: "newerData", event: { type: "showSticky", kind: "newerData" } },
  { name: "info (backup failed)", event: { type: "showInfo", kind: "backupFailed", lastBackupAt: Date.now() - 3_600_000 } },
  { name: "importResult", event: { type: "importUndone" } },
];

async function boxes(page: Page) {
  return toast(page).evaluate((el) => {
    const r = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const x = el.querySelector(".toast-x");
    return {
      toast: r(el),
      content: [...el.querySelectorAll(":scope > span, :scope > .undo-link, :scope > button:not(.toast-x), :scope > a")].map(r),
      x: x === null ? null : r(x),
      opacity: x === null ? null : Number(getComputedStyle(x).opacity),
      transition: x === null ? null : getComputedStyle(x).transitionDuration,
    };
  });
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const k of KINDS) {
  test(`SC-002 ${k.name}: the close button floats over the corner and closes the notification`, async () => {
    const { app, page } = await launchVesta();
    try {
      await page.mouse.move(2, 2);
      await page.evaluate((event) => {
        (window as unknown as { __vestaTest: { showNotice(e: unknown): void } }).__vestaTest.showNotice(event);
      }, k.event);
      await expect(toast(page)).toBeVisible();
      await page.waitForTimeout(200);
      // The Undo import notice counts its seconds down: measure right after a tick, so the count's width is the same
      // at rest and with the pointer over it.
      if (k.event["type"] === "showImportUndo") {
        const at = await toast(page).textContent();
        await expect.poll(() => toast(page).textContent(), { timeout: 2_000, intervals: [20] }).not.toBe(at);
      }
      // (b) hidden at rest.
      const rest = await boxes(page);
      expect(rest.opacity).toBe(0);
      // (a) the text and buttons stay where they are with the pointer over the notification.
      const tb = await toast(page).boundingBox();
      if (tb === null) throw new Error("no notification box");
      await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
      await expect.poll(async () => (await boxes(page)).opacity).toBe(1);
      const hover = await boxes(page);
      expect(hover.content).toEqual(rest.content);
      // (c) over the upper right corner, 18 × 18, covering no text or button.
      const x = hover.x;
      if (x === null) throw new Error("no close button");
      expect(x.w).toBe(18);
      expect(x.h).toBe(18);
      const cx = x.x + x.w / 2;
      const cy = x.y + x.h / 2;
      expect(Math.hypot(cx - (hover.toast.x + hover.toast.w), cy - hover.toast.y)).toBeLessThanOrEqual(10);
      for (const c of hover.content) expect(overlaps(x, c)).toBe(false);
      // (d) reached by keyboard: focused, it shows; Enter closes.
      await page.mouse.move(2, 2);
      await toast(page).locator(".toast-x").focus();
      await expect.poll(async () => (await boxes(page)).opacity).toBe(1);
      await expect(toast(page).locator(".toast-x")).toHaveAccessibleName("Close");
      // T089: it sits in the Tab order: back with Shift+Tab, then Tab reaches it again.
      await page.keyboard.press("Shift+Tab");
      await expect(toast(page).locator(".toast-x")).not.toBeFocused();
      await page.keyboard.press("Tab");
      await expect(toast(page).locator(".toast-x")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(toast(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}

test("SC-002 Tab from the last button reaches the close button; with Reduce Motion it appears without a fade", async () => {
  const { app, page } = await launchVesta();
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      (window as unknown as { __vestaTest: { showNotice(e: unknown): void } }).__vestaTest.showNotice({ type: "showUndo", kind: "delete", token: "t", title: "Fix bike" });
    });
    await toast(page).getByRole("button", { name: "Undo" }).focus();
    await page.keyboard.press("Tab");
    await expect(toast(page).locator(".toast-x")).toBeFocused();
    expect((await boxes(page)).transition).toBe("0s");
  } finally {
    await app.close();
  }
});

const show = (page: Page, event: Record<string, unknown>) =>
  page.evaluate((e) => {
    (window as unknown as { __vestaTest: { showNotice(e: unknown): void } }).__vestaTest.showNotice(e);
  }, event);

test("T089 FR-008 the 10 s countdown keeps running while the pointer is over the notification", async () => {
  const { app, page } = await launchVesta();
  try {
    await show(page, { type: "showUndo", kind: "done", token: "t", title: "Fix bike" });
    await expect(toast(page)).toBeVisible();
    const tb = await toast(page).boundingBox();
    if (tb === null) throw new Error("no notification box");
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await expect.poll(async () => (await boxes(page)).opacity).toBe(1);
    await page.waitForTimeout(5_000);
    await expect(toast(page)).toBeVisible();
    await expect(toast(page)).toHaveCount(0, { timeout: 7_000 });
  } finally {
    await app.close();
  }
});

test("T089 a notification whose text wraps: the close button stays at the corner, clear of the words, with nothing moved", async () => {
  const { app, page } = await launchVesta();
  try {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(700, 800);
    });
    await page.mouse.move(2, 2);
    const title = "Call the plumber about the kitchen sink and ask about the bathroom tap, the boiler and the garden hose too";
    await show(page, { type: "showUndo", kind: "done", token: "t", title });
    await expect(toast(page)).toBeVisible();
    await page.waitForTimeout(200);
    const rest = await boxes(page);
    // The text's own span, not the icon's; its line height is "normal", about 1.2 times the font size.
    const lines = await toast(page)
      .locator(":scope > span:not(.toast-icon)")
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().height / (1.2 * parseFloat(getComputedStyle(el).fontSize))));
    expect(lines).toBeGreaterThan(1);
    const tb = await toast(page).boundingBox();
    if (tb === null) throw new Error("no notification box");
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await expect.poll(async () => (await boxes(page)).opacity).toBe(1);
    const hover = await boxes(page);
    expect(hover.content).toEqual(rest.content);
    const x = hover.x;
    if (x === null) throw new Error("no close button");
    expect(Math.hypot(x.x + x.w / 2 - (hover.toast.x + hover.toast.w), x.y + x.h / 2 - hover.toast.y)).toBeLessThanOrEqual(10);
    for (const c of hover.content) expect(overlaps(x, c)).toBe(false);
  } finally {
    await app.close();
  }
});

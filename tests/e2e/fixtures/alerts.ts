/** Locators and a blink recorder for the alert specs (003). */
import type { Locator, Page } from "@playwright/test";

export const taskCard = (page: Page, title: string): Locator =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });

export interface BlinkRecord {
  id: string;
  blinks: number;
}

/**
 * Records every blink episode that starts on a task row (the row gains the `blink` class), with its
 * `--blinks` count. Episodes last 0.8–2.4 s, so polling for the class could miss one; this does not.
 */
export async function recordBlinks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __blinks?: { id: string; blinks: number }[]; __blinkObserver?: MutationObserver };
    w.__blinks = [];
    w.__blinkObserver?.disconnect();
    const seen = new WeakMap<Element, boolean>();
    const check = (el: Element, record = true) => {
      if (!(el instanceof HTMLElement) || el.dataset["kind"] !== "task") return;
      const on = el.classList.contains("blink");
      if (record && on && seen.get(el) !== true) {
        w.__blinks?.push({ id: el.dataset["id"] ?? "", blinks: Number(el.style.getPropertyValue("--blinks")) });
      }
      seen.set(el, on);
    };
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes") check(m.target as Element);
        for (const n of m.addedNodes) if (n instanceof Element) check(n);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style"] });
    // Episodes already playing when recording starts are not counted.
    document.querySelectorAll("li[data-kind='task']").forEach((el) => {
      check(el, false);
    });
    w.__blinkObserver = observer;
  });
}

export async function blinkLog(page: Page): Promise<BlinkRecord[]> {
  return page.evaluate(() => (window as unknown as { __blinks?: BlinkRecord[] }).__blinks ?? []);
}

export async function clearBlinkLog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __blinks?: unknown[] };
    if (w.__blinks !== undefined) w.__blinks.length = 0;
  });
}

/**
 * Waits until no row is blinking. The tests move the app clock by hours in milliseconds of real time, so a
 * re-blink could otherwise start while the previous episode (up to 2.4 s) is still playing.
 */
export async function waitBlinksDone(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector("li[data-kind='task'].blink") === null, undefined, { timeout: 5_000 });
}

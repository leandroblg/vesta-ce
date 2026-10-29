/** Network checks for the 005 specs (constitution I, FR-036). */
import { expect, type Page } from "@playwright/test";

/** Every request the window and its frames make, from now on. */
export function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    // 010 L13: the page and its stored files come from Vesta's own schemes; those loads are not network requests.
    const url = request.url();
    if (url.startsWith("app://") || url.startsWith("vesta-asset://")) return;
    urls.push(url);
  });
  return urls;
}

/** Network requests (http, https, ws) go only to the given hosts. */
export function expectOnly(urls: readonly string[], hosts: readonly string[]): void {
  const network = urls.filter((u) => /^(?:https?|wss?):/i.test(u));
  const outside = network.filter((u) => !hosts.includes(new URL(u).hostname));
  expect(outside, "requests outside the allowed hosts").toEqual([]);
}

/** Switches the network off (and on) through Chromium's emulation; navigator.onLine follows. */
export async function goOffline(page: Page, offline = true): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

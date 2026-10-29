// 018 FR-035, SC-009 (PRD Q285): Settings' close button sits at the upper left of its head, first in the Tab order, the
// toolbar of panes staying centered; the log viewer keeps its close button at the right.
import { expect, test, type Page } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";
import { dialog, openSettings, showPane, type SettingsPane } from "./fixtures/settings";

const PANES: SettingsPane[] = ["General", "Alerts", "Shortcuts", "Data", "Updates"];

async function geometry(page: Page) {
  return dialog(page).evaluate((d) => {
    const r = (e: Element | null) => e?.getBoundingClientRect() ?? null;
    const box = r(d.querySelector(".modal"));
    const head = r(d.querySelector(".modal-head"));
    const close = r(d.querySelector(".modal-head > .iconbtn"));
    const tabs = r(d.querySelector(".set-tabs"));
    return { box, head, close, tabs };
  });
}

for (const width of [700, 1200]) {
  test(`FR-035 at ${String(width)} px: the close button is at the upper left on every pane, the panes centered`, async () => {
    const { app, page } = await launchVesta();
    try {
      await app.evaluate(({ BrowserWindow }, w) => {
        BrowserWindow.getAllWindows()[0]?.setSize(w, 800);
      }, width);
      await openSettings(page);
      for (const pane of PANES) {
        await showPane(page, pane);
        const g = await geometry(page);
        if (g.box === null || g.head === null || g.close === null || g.tabs === null) throw new Error("missing parts");
        expect(g.close.left - g.box.left, pane).toBeLessThanOrEqual(16);
        expect(Math.abs(g.close.top + g.close.height / 2 - (g.head.top + g.head.height / 2)), pane).toBeLessThanOrEqual(2);
        expect(Math.abs(g.tabs.left + g.tabs.width / 2 - (g.box.left + g.box.width / 2)), pane).toBeLessThanOrEqual(1);
      }
    } finally {
      await app.close();
    }
  });
}

test("FR-035 Tab from the head reaches Close before the first pane; Close closes Settings; Logs keeps its close at the right", async () => {
  const { page, app } = await launchVesta();
  try {
    await openSettings(page, "General");
    await dialog(page).locator(".modal-head").focus();
    await page.keyboard.press("Tab");
    await expect(dialog(page).getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog(page).getByRole("tab").first()).toBeFocused();
    await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await openSettings(page, "Data");
    await dialog(page).getByTestId("logs-open").click();
    const logs = page.locator(".log-dialog");
    await expect(logs).toBeVisible();
    const g = await logs.evaluate((d) => ({
      box: (d.querySelector(".modal") ?? d).getBoundingClientRect(),
      close: d.querySelector(".modal-head > .iconbtn")?.getBoundingClientRect() ?? null,
    }));
    if (g.close === null) throw new Error("no log close button");
    expect(g.box.right - g.close.right).toBeLessThanOrEqual(16);
  } finally {
    await app.close();
  }
});

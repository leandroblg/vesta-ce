/**
 * 015 User Story 4: the Settings dialog opens centered at 60 %, grows downward to a 10 % margin, then scrolls; it can
 * be moved and resized until it closes (FR-025 to FR-027b, SC-006; PRD Q204, Q211, Q212, Q218, Q219;
 * ui.md "Settings dialog").
 */
import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { launchVesta } from "./fixtures/launch";
import {
  IS_MAC,
  closeSettings,
  openSettings,
  showPane,
} from "./fixtures/settings";

const box = (page: Page) => page.locator("dialog.settings-dialog[open]");
const near = (a: number, b: number) => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
};

async function resize(
  app: ElectronApplication,
  page: Page,
  w: number,
  h: number,
) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.w, size.h);
    },
    { w, h },
  );
  await page.waitForFunction(
    (size) => window.innerWidth === size.w && window.innerHeight === size.h,
    { w, h },
  );
}

async function rect(page: Page) {
  const b = await box(page).boundingBox();
  if (b === null) throw new Error("no dialog");
  return b;
}

test("015 US4: 60 % centered on every pane, growing downward, then scrolling; resize, drag, reset and the smallest window", async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchVesta();
  try {
    await resize(app, page, 1200, 800);
    await openSettings(page, "General");
    // US4 1 and 2: 720 wide, centered, top at 160; 016 FR-036 (Q236): as tall as a pane that fits, never under 320.
    let r = await rect(page);
    near(r.width, 720);
    near(r.x, 240);
    near(r.y, 160);
    expect(r.height).toBeGreaterThanOrEqual(320 - 1);
    expect(r.height).toBeLessThan(560);
    // The pane's name sits under the toolbar and does not scroll (Q219).
    await expect(box(page).locator(".modal-body .pane-title")).toHaveCount(0);
    for (const pane of ["Alerts", "Shortcuts", "Data", "Updates"] as const) {
      await showPane(page, pane);
      const p = await rect(page);
      near(p.width, 720);
      near(p.y, 160);
      expect(p.height).toBeGreaterThanOrEqual(320 - 1);
      expect(p.y + p.height).toBeLessThanOrEqual(800 - 80 + 1);
    }
    // US4 3 and 4: Shortcuts reaches the 10 % margin and its body scrolls, the toolbar unmoved.
    await showPane(page, "Shortcuts");
    r = await rect(page);
    near(r.y + r.height, 720);
    const tabs = box(page).locator(".set-tabs");
    const before = await tabs.boundingBox();
    const scrolled = await box(page)
      .locator(".modal-body")
      .evaluate((body) => {
        body.scrollTop = 400;
        return body.scrollTop > 0;
      });
    expect(scrolled).toBe(true);
    expect((await tabs.boundingBox())?.y).toBe(before?.y);

    // US4 5: a window resize keeps the proportions.
    await showPane(page, "General");
    await resize(app, page, 1000, 700);
    r = await rect(page);
    near(r.width, 600);
    near(r.x, 200);
    near(r.y, 140);

    // US4 6: drag the toolbar's empty space and the bottom-right handle; it follows and keeps its place on a pane change.
    const head = box(page).locator(".modal-head");
    const hb = (await head.boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    await page.mouse.move(hb.x + 8, hb.y + 8);
    await page.mouse.down();
    await page.mouse.move(hb.x + 8 - 100, hb.y + 8 + 50, { steps: 5 });
    await page.mouse.up();
    r = await rect(page);
    near(r.x, 100);
    near(r.y, 190);
    const handle = box(page).locator(".rz.se");
    const sb = (await handle.boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      sb.x + sb.width / 2 - 500,
      sb.y + sb.height / 2 - 400,
      { steps: 5 },
    );
    await page.mouse.up();
    r = await rect(page);
    near(r.width, 360);
    near(r.height, 320);
    await showPane(page, "Shortcuts");
    const kept = await rect(page);
    near(kept.x, r.x);
    near(kept.height, 320);

    // US4 7: reopened, it is back to 60 % centered.
    await closeSettings(page);
    await openSettings(page, "General");
    r = await rect(page);
    near(r.width, 600);
    near(r.x, 200);
    await closeSettings(page);

    // 016 Q244: in the smallest window the 360 × 320 floor wins over the 60 % share and every margin.
    await resize(app, page, 360, 420);
    await openSettings(page, "General");
    r = await rect(page);
    near(r.width, 360);
    near(r.x, 0);
    expect(r.height).toBeGreaterThanOrEqual(320 - 1);
    expect(r.y + r.height).toBeLessThanOrEqual(420 + 1);

    // FR-027a: on macOS the toolbar's drag region does not take the pointer under the dialog.
    if (IS_MAC) {
      const region = await page.evaluate(() =>
        getComputedStyle(
          document.querySelector(".topbar") as Element,
        ).getPropertyValue("-webkit-app-region"),
      );
      expect(region).toBe("no-drag");
    }
  } finally {
    await app.close();
  }
});

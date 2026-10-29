/** 003 User Story 1: tasks go stale, blink, re-blink, show their age; nothing outside the window (T032). */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { blinkLog, recordBlinks, taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, minimize, readTask, restoreWindow, tick, tickCount } from "./fixtures/clock";
import { freshDataDir, launchVesta, relaunch, type Launched } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { backToTasks } from "./fixtures/nav";

const blinksOn = async (page: Page, id: string) => (await blinkLog(page)).filter((b) => b.id === id).map((b) => b.blinks);

async function launchWith(titles: { title: string; ageMs?: number }[], env: Record<string, string> = {}): Promise<Launched & { ids: Record<string, string> }> {
  const dataDir = freshDataDir();
  const now = Date.now();
  const rows = titles.map(({ title, ageMs = 0 }, i) => task({ titleMd: title, position: i + 1, createdAt: now - ageMs, updatedAt: now - ageMs }));
  seedTasks(dataDir, rows);
  const launched = await launchVesta({ dataDir, env });
  await launched.page.waitForFunction(() => Number(document.documentElement.dataset["alertTicks"] ?? "0") > 0);
  return { ...launched, ids: Object.fromEntries(rows.map((r) => [r.titleMd, r.id])) };
}

/** Lets the current episode finish, advances the app clock and runs one tick. */
async function at(app: ElectronApplication, page: Page, ms: number) {
  await waitBlinksDone(page);
  await advanceClock(app, ms);
  await tick(page);
}

test.describe("003 US1 — stale tasks", () => {
  test("goes stale just after 24 h: 3 blinks, light red, stale label and age (scenarios 1–5)", async () => {
    const { app, page, ids } = await launchWith([{ title: "Renew passport" }]);
    try {
      await recordBlinks(page);
      const card = taskCard(page, "Renew passport");
      await at(app, page, DAY - MIN);
      await expect(card).not.toHaveClass(/\bstale\b/);
      await expect(card.locator(".age")).toHaveCount(0);

      await at(app, page, 2 * MIN);
      await expect(card).toHaveClass(/\bstale\b/);
      expect(await blinksOn(page, ids["Renew passport"] ?? "")).toEqual([3]);
      await expect(card).not.toHaveClass(/\bblink\b/, { timeout: 4_000 });
      await expect(card).toHaveClass(/\bstale\b/);
      await expect(card.locator(".age")).toHaveText(/stale\s*1d 0h/i);
      await expect(card).toHaveAttribute("aria-label", "Renew passport, stale");
      await expect(card.locator(".age svg")).toHaveCount(1);

      await at(app, page, HOUR + 1);
      await expect(card.locator(".age .v")).toHaveText("1d 1h");
    } finally {
      await app.close();
    }
  });

  test("re-blinks 3 times every 4 h while visible, and not in between (scenario 6)", async () => {
    const { app, page, ids } = await launchWith([{ title: "Old", ageMs: DAY + MIN }]);
    try {
      await tick(page);
      await recordBlinks(page);
      await at(app, page, 4 * HOUR - 2 * MIN);
      expect(await blinksOn(page, ids["Old"] ?? "")).toEqual([]);
      await at(app, page, 3 * MIN);
      expect(await blinksOn(page, ids["Old"] ?? "")).toEqual([3]);
      await at(app, page, 2 * HOUR);
      expect(await blinksOn(page, ids["Old"] ?? "")).toEqual([3]);
      await at(app, page, 2 * HOUR + MIN);
      expect(await blinksOn(page, ids["Old"] ?? "")).toEqual([3, 3]);
    } finally {
      await app.close();
    }
  });

  test("went stale while the app was closed: blinks once on launch, next re-blink one interval later (scenario 7, launch tick)", async () => {
    const dataDir = freshDataDir();
    const old = task({ titleMd: "Closed", createdAt: Date.now() - DAY - HOUR });
    seedTasks(dataDir, [old]);
    const started = Date.now();
    const { app, page } = await launchVesta({ dataDir });
    try {
      // No event is dispatched: the driver's own first tick plays it.
      await expect.poll(() => readTask(dataDir, old.id)?.last_blink_at ?? null, { timeout: 2_000 }).not.toBeNull();
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(readTask(dataDir, old.id)).toMatchObject({ first_blink_count: 1, was_stale: 1 });
      await recordBlinks(page);
      await at(app, page, 4 * HOUR - MIN);
      expect(await blinksOn(page, old.id)).toEqual([]);
      await at(app, page, 2 * MIN);
      expect(await blinksOn(page, old.id)).toEqual([3]);
    } finally {
      await app.close();
    }
  });

  test("went stale while minimized: blinks once on restore; a missed re-blink plays once (scenarios 8, 11)", async () => {
    const { app, page, ids } = await launchWith([{ title: "Hidden" }]);
    try {
      await recordBlinks(page);
      await minimize(app);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);
      await at(app, page, DAY + MIN);
      expect(await blinksOn(page, ids["Hidden"] ?? "")).toEqual([]);
      const before = await tickCount(page);
      await restoreWindow(app);
      await page.waitForFunction((n) => Number(document.documentElement.dataset["alertTicks"]) > n, before);
      await expect.poll(() => blinksOn(page, ids["Hidden"] ?? "")).toEqual([1]);

      await minimize(app);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);
      await at(app, page, 9 * HOUR);
      await restoreWindow(app);
      await expect.poll(() => blinksOn(page, ids["Hidden"] ?? "")).toEqual([1, 3]);
    } finally {
      await app.close();
    }
  });

  test("went stale while the Archive was shown: blinks once on return (scenario 9, Q93)", async () => {
    const { app, page, ids } = await launchWith([{ title: "Waiting" }]);
    try {
      await recordBlinks(page);
      await page.getByRole("button", { name: /Archive/ }).first().click();
      await at(app, page, DAY + MIN);
      await backToTasks(page);
      await expect.poll(() => blinksOn(page, ids["Waiting"] ?? "")).toEqual([1]);
    } finally {
      await app.close();
    }
  });

  test("went stale while asleep: blinks once at the wake tick (scenario 10)", async () => {
    const { app, page, ids } = await launchWith([{ title: "Sleepy" }]);
    try {
      await recordBlinks(page);
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit("suspend"));
      await advanceClock(app, DAY + MIN);
      const before = await tickCount(page);
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit("resume"));
      await page.waitForFunction((n) => Number(document.documentElement.dataset["alertTicks"]) > n, before);
      await expect.poll(() => blinksOn(page, ids["Sleepy"] ?? "")).toEqual([1]);
    } finally {
      await app.close();
    }
  });

  test("reduced motion: no animation, a steady outline for the episode, then light red (scenario 13)", async () => {
    const { app, page } = await launchWith([{ title: "Calm" }]);
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const card = taskCard(page, "Calm");
      await at(app, page, DAY + MIN);
      await expect(card).toHaveClass(/\bblink\b/);
      expect(await card.evaluate((el) => el.getAnimations().length)).toBe(0);
      expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("inset");
      await expect(card).not.toHaveClass(/\bblink\b/, { timeout: 4_000 });
      expect(await card.evaluate((el) => getComputedStyle(el).boxShadow)).not.toContain("inset");
      await expect(card).toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("clock moved back 2 days: no negative age, next re-blink one interval later (FR-045a)", async () => {
    const { app, page, ids } = await launchWith([{ title: "Back" }]);
    try {
      await at(app, page, DAY + MIN);
      await recordBlinks(page);
      await at(app, page, -2 * DAY);
      const card = taskCard(page, "Back");
      await expect(card).toHaveClass(/\bstale\b/);
      await expect(card.locator(".age .v")).toHaveText("0m");
      expect(await blinksOn(page, ids["Back"] ?? "")).toEqual([]);
      await at(app, page, 4 * HOUR - MIN);
      expect(await blinksOn(page, ids["Back"] ?? "")).toEqual([]);
      await at(app, page, 2 * MIN);
      expect(await blinksOn(page, ids["Back"] ?? "")).toEqual([3]);
    } finally {
      await app.close();
    }
  });

  test("never an OS notification or a badge (scenario 14, FR-023)", async () => {
    const { app, page } = await launchWith([{ title: "Quiet" }]);
    try {
      await page.evaluate(() => {
        const w = window as unknown as { __notified: number; Notification: unknown };
        w.__notified = 0;
        w.Notification = function () {
          w.__notified += 1;
        };
      });
      await at(app, page, DAY + MIN);
      await at(app, page, 4 * HOUR);
      expect(await page.evaluate(() => (window as unknown as { __notified: number }).__notified)).toBe(0);
      expect(await app.evaluate(({ app: electronApp }) => electronApp.getBadgeCount())).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("periodic tick: goes stale with no event, through the 60 s timer (SC-001)", async () => {
    test.setTimeout(120_000);
    const { app, page } = await launchWith([{ title: "Timer" }]);
    try {
      await advanceClock(app, DAY + MIN);
      await expect(taskCard(page, "Timer")).toHaveClass(/\bstale\b/, { timeout: 90_000 });
    } finally {
      await app.close();
    }
  });

  test("time zones change nothing: same stale moment and age label (FR-045)", async () => {
    const createdAt = Date.now() - DAY - HOUR - 30 * MIN;
    const results: { staleSince: number | null; label: string }[] = [];
    for (const tz of ["UTC", "Pacific/Auckland"]) {
      const dataDir = freshDataDir();
      const row = task({ titleMd: "Zoned", createdAt, updatedAt: createdAt });
      seedTasks(dataDir, [row]);
      const { app, page } = await launchVesta({ dataDir, env: { TZ: tz } });
      try {
        await tick(page);
        const label = (await taskCard(page, "Zoned").locator(".age .v").textContent()) ?? "";
        results.push({ staleSince: readTask(dataDir, row.id)?.stale_since ?? null, label });
      } finally {
        await app.close();
      }
    }
    expect(results[0]).toEqual({ staleSince: createdAt + DAY, label: "1d 1h" });
    expect(results[1]).toEqual(results[0]);
  });

  test("a relaunch keeps the stale state and does not blink again", async () => {
    const launched = await launchWith([{ title: "Sticky", ageMs: DAY + HOUR }]);
    let run: Launched = launched;
    try {
      const id = launched.ids["Sticky"] ?? "";
      await expect.poll(() => readTask(run.dataDir, id)?.last_blink_at ?? null).not.toBeNull();
      const before = readTask(run.dataDir, id);
      run = await relaunch(run);
      await run.page.waitForFunction(() => Number(document.documentElement.dataset["alertTicks"] ?? "0") > 0);
      await tick(run.page);
      await expect(taskCard(run.page, "Sticky")).toHaveClass(/\bstale\b/);
      expect(readTask(run.dataDir, id)).toMatchObject({ stale_since: before?.stale_since, last_blink_at: before?.last_blink_at });
    } finally {
      await run.app.close();
    }
  });
});

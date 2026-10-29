/** 003 quickstart scenarios not covered by the story specs: settings (Story 7), upgrade check, hand check. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { blinkLog, recordBlinks, taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, MIN, advanceClock, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { SCHEMA_VERSION, reminder, seedReminders, seedSettings, seedTasks, seedTasksAtVersion, task } from "./fixtures/seed";

function settingsRows(dataDir: string): Record<string, string> {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    const rows = db.prepare("select key, value from settings").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } finally {
    db.close();
  }
}

function logLines(dataDir: string, event: string): Record<string, unknown>[] {
  const file = join(dataDir, "logs", "vesta-001.log");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l["event"] === event);
}

test.describe("003 quickstart", () => {
  test("settings: defaults on a fresh folder; missing, unreadable and out-of-range values are handled and logged once (Story 7)", async () => {
    const fresh = await launchVesta();
    try {
      expect(settingsRows(fresh.dataDir)).toMatchObject({ alertPeriodMin: "1440", reblinkIntervalMin: "240", rescheduleToleranceMin: "1440" });
      expect(logLines(fresh.dataDir, "settings.issue")).toEqual([]);
    } finally {
      await fresh.app.close();
    }

    const dataDir = freshDataDir();
    const now = Date.now();
    const old = task({ titleMd: "Day old", position: 1, createdAt: now - 25 * HOUR });
    const resched = task({ titleMd: "Rescheduled", position: 2, createdAt: now - 3 * 24 * HOUR, staleBaseAt: now - 61 * MIN, wasStale: true });
    seedTasks(dataDir, [old, resched]);
    seedSettings(dataDir, { alertPeriodMin: null, reblinkIntervalMin: "abc", rescheduleToleranceMin: "0" });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await tick(page);
      const issues = logLines(dataDir, "settings.issue").map((l) => [l["key"], l["kind"]]);
      expect(issues).toEqual([
        ["alertPeriodMin", "missing"],
        ["reblinkIntervalMin", "unreadable"],
        ["rescheduleToleranceMin", "clamped"],
      ]);
      await expect(taskCard(page, "Day old")).toHaveClass(/\bstale\b/);
      await expect(taskCard(page, "Rescheduled")).toHaveClass(/\bstale\b/);
      expect(readTask(dataDir, resched.id)?.stale_since).toBe(now - 61 * MIN + 60 * MIN);
    } finally {
      await app.close();
    }
  });

  test("settings: a stored alert period of 48 h keeps a 30 h-old task fresh (Story 7)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Thirty", createdAt: Date.now() - 30 * HOUR })]);
    seedSettings(dataDir, { alertPeriodMin: "2880" });
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await expect(taskCard(page, "Thirty")).not.toHaveClass(/\bstale\b/);
    } finally {
      await app.close();
    }
  });

  test("upgrade check: a version-2 folder opens at version 3 with stale tasks marked once, reminders unchanged, a version-2 pre-upgrade backup", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const thirty = task({ titleMd: "Thirty hours", position: 1, createdAt: now - 30 * HOUR, updatedAt: now - 30 * HOUR });
    const ten = task({ titleMd: "Ten hours", position: 2, createdAt: now - 10 * HOUR });
    const one = task({ titleMd: "One hour", position: 3, createdAt: now - HOUR });
    seedTasksAtVersion(dataDir, [thirty, ten, one], 2);
    seedReminders(dataDir, [reminder({ textMd: "Kept reminder", position: 1 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      expect(readTask(dataDir, thirty.id)).toMatchObject({ stale_since: thirty.createdAt + DAY, first_blink_count: 1, was_stale: 1 });
      await expect.poll(() => readTask(dataDir, thirty.id)?.last_blink_at ?? null).not.toBeNull();
      await expect(taskCard(page, "Thirty hours").locator(".age .v")).toHaveText("1d 6h");
      await expect(taskCard(page, "Ten hours")).not.toHaveClass(/\bstale\b/);
      await expect(taskCard(page, "One hour")).not.toHaveClass(/\bstale\b/);
      await expect(page.locator("li[data-kind='rem'] .title")).toHaveText(["Kept reminder"]);
      const latest = JSON.parse(readFileSync(join(dataDir, "backups", "latest.json"), "utf8")) as { schemaVersion: number };
      expect(latest.schemaVersion).toBe(2);
      expect(settingsRows(dataDir)).toMatchObject({ alertPeriodMin: "1440", reblinkIntervalMin: "240", rescheduleToleranceMin: "1440" });
      const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
      try {
        expect((db.prepare("select version from schema_version").get() as { version: number }).version).toBe(SCHEMA_VERSION);
      } finally {
        db.close();
      }
    } finally {
      await app.close();
    }
  });

  test("hand check (runbook 003 step L): tasks made in a normal run, relaunched with VESTA_CLOCK_OFFSET_MIN=1500", async () => {
    let run = await launchVesta();
    const { page } = run;
    await page.getByRole("button", { name: "New task…" }).click();
    const editor = page.getByRole("textbox", { name: "New task…" });
    for (const title of ["Renew passport", "Prepare report", "Fix bike"]) {
      await editor.fill(title);
      await editor.press("Enter");
    }
    await editor.press("Escape");
    const report = taskCard(page, "Prepare report");
    await clickRevealed(report, report.getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "New Subtask" }).click();
    const sub = page.getByRole("textbox", { name: "New subtask…" });
    await sub.fill("Gather numbers");
    await sub.press("Enter");
    await sub.press("Escape");
    await report.getByRole("button", { name: "Collapse" }).click();
    // "Fix bike" gets a 3-day override, so it stays fresh at +25 h.
    const bike = taskCard(page, "Fix bike");
    await clickRevealed(bike, bike.getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "Alert Period…" }).click();
    const dialog = page.getByRole("dialog", { name: "Alert override" });
    await dialog.getByRole("checkbox").click();
    await dialog.getByRole("spinbutton", { name: "Days" }).fill("3");
    await page.keyboard.press("Escape");

    run = await relaunch(run, { env: { VESTA_CLOCK_OFFSET_MIN: "1500" } });
    try {
      const p = run.page;
      await recordBlinks(p);
      await tick(p);
      // A task older than 24 h: stale, icon and an age label such as 1d 1h.
      const passport = taskCard(p, "Renew passport");
      await expect(passport).toHaveClass(/\bstale\b/);
      await expect(passport.locator(".age svg")).toHaveCount(1);
      await expect(passport.locator(".age .v")).toHaveText("1d 1h");
      // Stale tasks on top, oldest first, carrying their subtasks; the collapsed parent shows the indicator.
      await expect(p.locator("li[data-kind='task']:not(.sub) .title")).toHaveText(["Renew passport", "Prepare report", "Fix bike"]);
      await expect(taskCard(p, "Prepare report").locator(".stale-sub")).toBeVisible();
      // Reschedule clears at once; the auto-sorted task moves to the top of the non-stale tasks.
      await waitBlinksDone(p);
      await clickRevealed(passport, passport.getByRole("button", { name: "Reschedule" }));
      await expect(passport).not.toHaveClass(/\bstale\b/);
      await expect(p.locator("li[data-kind='task']:not(.sub) .title")).toHaveText(["Prepare report", "Renew passport", "Fix bike"]);
      // Alert override: changes apply at once, minimum 1 h, Use global default removes it.
      await expect(taskCard(p, "Fix bike")).not.toHaveClass(/\bstale\b/);
      const fix = taskCard(p, "Fix bike");
      await clickRevealed(fix, fix.getByRole("button", { name: "More actions" }));
      await p.getByRole("menuitem", { name: "Alert Period…" }).click();
      const ov = p.getByRole("dialog", { name: "Alert override" });
      await ov.getByRole("spinbutton", { name: "Days" }).fill("0");
      await expect(ov).toContainText("The minimum is 1 hour.");
      await ov.getByRole("checkbox").click();
      await expect(fix).toHaveClass(/\bstale\b/);
      await p.keyboard.press("Escape");
      // Reduced motion: no blinking, only a static highlight.
      await p.emulateMedia({ reducedMotion: "reduce" });
      await waitBlinksDone(p);
      await advanceClock(run.app, 4 * HOUR);
      await tick(p);
      expect(await taskCard(p, "Prepare report").evaluate((el) => el.getAnimations().length)).toBe(0);
      // A stale task marked done shows a gray stale tag and its total time in the Archive.
      await taskCard(p, "Prepare report").getByRole("checkbox").click();
      await p.getByRole("button", { name: /^Archive/ }).click();
      await expect(p.locator("li.arow", { hasText: "Prepare report" }).locator(".gtag")).toContainText("1d 5h from creation");
      expect((await blinkLog(p)).length).toBeGreaterThan(0);
    } finally {
      await run.app.close();
    }
  });
});

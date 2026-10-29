/**
 * 016 User Story 2: the history as a timeline, with times (FR-008 to FR-012, SC-002, SC-003; PRD Q226, Q227, Q229,
 * Q249, Q250; ui.md "Details panel status and history").
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, HOUR, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { setLanguage } from "./fixtures/settings";

const items = (page: Page) => page.locator(".panel-history ol.timeline li");
/** "Oct 25, 2026 at 09:14" in English: a date, then a time. */
const DATE_AND_TIME = /\d{4} at \d{1,2}:\d{2}/;

/** The dot's color and the color a probe with `background: <css>` gets, inside the panel (same theme). */
async function dotColors(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const li of document.querySelectorAll<HTMLElement>(".panel-history ol.timeline li")) {
      const dot = li.querySelector<HTMLElement>(".dot");
      if (dot !== null) out[li.dataset["kind"] ?? ""] = getComputedStyle(dot).backgroundColor;
    }
    const probe = (css: string) => {
      const el = document.createElement("span");
      el.style.background = css;
      document.querySelector(".panel-history")?.append(el);
      const c = getComputedStyle(el).backgroundColor;
      el.remove();
      return c;
    };
    out["@stale"] = probe("var(--stale)");
    out["@muted"] = probe("var(--muted)");
    out["@gold"] = probe("color-mix(in srgb, var(--flame) 70%, var(--fg))");
    return out;
  });
}

function addEvent(dataDir: string, taskId: string, kind: string, at: number, detail: number | null): void {
  const db = new Database(join(dataDir, "data.sqlite"));
  try {
    db.prepare("insert into task_events (id, task_id, kind, at, detail) values (?, ?, ?, ?, ?)").run(randomUUID(), taskId, kind, at, detail);
  } finally {
    db.close();
  }
}

test.describe("016 US2 — the history as a timeline, with times", () => {
  test("Stale since shows the date and the time; the timeline has a dot per entry, colored by kind, the time under the words (scenarios 1, 3, 4)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Timeline", position: 1, createdAt: Date.now() - 30 * HOUR })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await waitBlinksDone(page);
      const card = taskCard(page, "Timeline");
      // A plain reschedule records the tolerance in force (Q229): "Rescheduled for 1d" (Q249).
      await clickRevealed(card, card.locator(".act.resched"));
      await card.locator(".title").click();
      await expect(items(page).filter({ hasText: "Rescheduled for 1d" })).toHaveCount(1);
      await expect(page.locator(".panel-history ol.timeline")).toHaveCount(1);
      const count = await items(page).count();
      await expect(items(page).locator(".dot")).toHaveCount(count);
      await expect(items(page).locator(".dot").first()).toHaveAttribute("aria-hidden", "true");
      // The words, then the time on its own line below them.
      const first = items(page).first();
      const what = (await first.locator(".what").boundingBox()) ?? { y: 0, height: 0 };
      const when = (await first.locator("time").boundingBox()) ?? { y: 0 };
      expect(when.y).toBeGreaterThanOrEqual(what.y + what.height - 1);
      await expect(first.locator("time")).toContainText(DATE_AND_TIME);
      const colors = await dotColors(page);
      expect(colors["rescheduled"]).toBe(colors["@gold"]);
      expect(colors["stale"]).toBe(colors["@stale"]);
      expect(colors["created"]).toBe(colors["@muted"]);

      // Undo brings the stale status back: "Stale since … at …" (Q227).
      await page.getByTestId("notification").getByRole("button", { name: "Undo" }).click();
      await expect(page.locator(".meta-grid .pill.stale")).toContainText(/Stale since .*\d{4} at \d{1,2}:\d{2}/);
    } finally {
      await app.close();
    }
  });

  test("Done on and Deleted on show the date and the time in the read-only panels, with the same timeline (scenarios 2, 8)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [
      task({ titleMd: "Finished", position: 1, createdAt: now - 2 * DAY, doneAt: now - HOUR }),
      task({ titleMd: "Binned", position: 2, createdAt: now - 2 * DAY, deletedAt: now - HOUR }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator("li.arow", { hasText: "Finished" }).locator(".title").click();
      await expect(page.locator(".meta-grid .pill")).toContainText(DATE_AND_TIME);
      await expect(page.locator(".panel-history ol.timeline li .dot").first()).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Trash/ }).click();
      await page.locator("li.arow", { hasText: "Binned" }).locator(".title").click();
      await expect(page.locator(".meta-grid .pill")).toContainText(DATE_AND_TIME);
      await expect(page.locator(".panel-history ol.timeline")).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test("an entry recorded before this feature, with no duration, stays bare (scenario 6); Was stale has an ember dot (Q250)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const old = task({ titleMd: "Old entry", position: 1, createdAt: now - 3 * DAY, staleBaseAt: now - DAY });
    const was = task({ titleMd: "Was stale one", position: 2, createdAt: now - 5 * DAY, doneAt: now - DAY, wasStale: true });
    seedTasks(dataDir, [old, was]);
    addEvent(dataDir, old.id, "created", now - 3 * DAY, null);
    addEvent(dataDir, old.id, "rescheduled", now - DAY, null);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Old entry").locator(".title").click();
      await expect(items(page).filter({ hasText: /^Rescheduled/ })).toHaveCount(1);
      await expect(items(page).filter({ hasText: "Rescheduled for" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator("li.arow", { hasText: "Was stale one" }).locator(".title").click();
      const colors = await dotColors(page);
      expect(colors["wasStale"]).toBe(colors["@stale"]);
      await expect(items(page).filter({ hasText: "Was stale" }).locator("time")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("in the Minimalist theme and in French the timeline keeps its dots and the words (scenario 7)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Thème", position: 1, createdAt: Date.now() - 30 * HOUR })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await tick(page);
      await setLanguage(page, "fr", "fr");
      await page.locator("#set-palette").selectOption("minimal");
      await page.keyboard.press("Escape");
      await taskCard(page, "Thème").locator(".title").click();
      await expect(items(page).first().locator(".dot")).toBeVisible();
      await expect(items(page).filter({ hasText: "Créée" })).toHaveCount(1);
      const colors = await dotColors(page);
      expect(colors["stale"]).toBe(colors["@stale"]);
      expect(colors["created"]).toBe(colors["@muted"]);
    } finally {
      await app.close();
    }
  });
});

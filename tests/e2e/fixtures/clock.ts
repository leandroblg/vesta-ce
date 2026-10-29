/** App clock, alert ticks and window visibility for the alert specs (003 quickstart.md, research §8). */
import { join } from "node:path";
import Database from "better-sqlite3";
import type { ElectronApplication, Page } from "@playwright/test";
import type { Task } from "../../../src/domain/task";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

interface ClockHook {
  advance(ms: number): void;
  set(ms: number): void;
}

/** Moves the app clock forward by `ms` (unpackaged builds only). */
export async function advanceClock(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, delta) => {
    (globalThis as unknown as { __vestaClock: ClockHook }).__vestaClock.advance(delta);
  }, ms);
}

/** Sets the app clock to `ms` (epoch milliseconds), backwards too. */
export async function setClock(app: ElectronApplication, ms: number): Promise<void> {
  await app.evaluate((_electron, at) => {
    (globalThis as unknown as { __vestaClock: ClockHook }).__vestaClock.set(at);
  }, ms);
}

/** Number of alert ticks the renderer has finished (the driver counts them on the root element). */
export async function tickCount(page: Page): Promise<number> {
  return page.evaluate(() => Number(document.documentElement.dataset["alertTicks"] ?? "0"));
}

/** Triggers an alert tick (window focus) and waits until its reply has been applied. */
export async function tick(page: Page): Promise<void> {
  const before = await tickCount(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction((n) => Number(document.documentElement.dataset["alertTicks"] ?? "0") > n, before);
}

export async function minimize(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.minimize();
  });
}

export async function restoreWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.restore();
    win?.show();
  });
}

interface TaskRow {
  id: string;
  title_md: string;
  details_md: string;
  created_at: number;
  done_at: number | null;
  updated_at: number;
  stale_base_at: number;
  stale_since: number | null;
  was_stale: number;
  last_blink_at: number | null;
  first_blink_count: number | null;
  manually_positioned: number;
  last_signal_at: number | null;
  alert_period_override_min: number | null;
  collapsed: number;
  position: number;
  reschedule_for_min: number | null;
}

/** One `tasks` row, read with a read-only connection while the app runs. */
export function readTask(dataDir: string, id: Task["id"]): TaskRow | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select * from tasks where id = ?").get(id) as TaskRow | undefined;
  } finally {
    db.close();
  }
}

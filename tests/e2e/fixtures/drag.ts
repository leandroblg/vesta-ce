/** Pointer-driven drags and list readers for the drag-and-drop specs (004 quickstart.md "Test controls"). */
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Locator, Page } from "@playwright/test";

export type Zone = "upper" | "middle" | "lower";
export type IndicatorKind = "line-top" | "line-sub" | "card" | "group" | null;

/** The vertical centre of each card zone (FR-007: 0–28%, 28–72%, 72–100%). */
const ZONE_AT: Record<Zone, number> = { upper: 0.14, middle: 0.5, lower: 0.86 };

export type DragTarget = { row: Locator; zone: Zone } | { emptyCard: "task" | "rem" } | { point: { x: number; y: number } };

/** The indicator the overlay shows now (`.drop-overlay[data-indicator]`), or null when none is shown. */
export async function readIndicator(page: Page): Promise<IndicatorKind> {
  const overlay = page.locator(".drop-overlay[data-indicator]");
  if ((await overlay.count()) === 0) return null;
  return (await overlay.first().getAttribute("data-indicator")) as IndicatorKind;
}

async function targetPoint(page: Page, target: DragTarget): Promise<{ x: number; y: number }> {
  if ("point" in target) return target.point;
  const row = "row" in target ? target.row : page.locator(`li[data-kind='new-${target.emptyCard}']`);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  if (box === null) throw new Error("drag target is not visible");
  const f = "zone" in target ? ZONE_AT[target.zone] : 0.5;
  return { x: box.x + box.width / 2, y: box.y + box.height * f };
}

/**
 * Presses on the source card's title, moves 6 px (past the 4 px threshold), then in `steps` to the target
 * point, reads the indicator before release, and releases unless `release` is false. Returns the indicator.
 */
export async function dragTo(
  page: Page,
  source: Locator,
  target: DragTarget,
  opts: { release?: boolean; steps?: number; grab?: Locator } = {},
): Promise<IndicatorKind> {
  const grab = opts.grab ?? source.locator(".title");
  await grab.scrollIntoViewIfNeeded();
  const box = await grab.boundingBox();
  if (box === null) throw new Error("drag source is not visible");
  const start = { x: box.x + Math.min(20, box.width / 2), y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 6, { steps: 2 });
  const end = await targetPoint(page, target);
  await page.mouse.move(end.x, end.y, { steps: opts.steps ?? 8 });
  // One frame for the controller's rAF update.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const indicator = await readIndicator(page);
  if (opts.release ?? true) await page.mouse.up();
  return indicator;
}

export interface ShownRow {
  title: string;
  level: "top" | "sub";
  inGroup: boolean;
}

/** The task list as shown: each card's title, level and stale-group membership, in order. */
export async function readOrder(page: Page): Promise<ShownRow[]> {
  return page.locator("li[data-kind='task']").evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector(".title")?.textContent ?? "",
      level: el.classList.contains("sub") ? ("sub" as const) : ("top" as const),
      inGroup: (el as HTMLElement).dataset["group"] === "1",
    })),
  );
}

/** The shown titles only, a shorthand for most assertions. */
export async function readTitles(page: Page): Promise<string[]> {
  return (await readOrder(page)).map((r) => (r.level === "sub" ? `  ${r.title}` : r.title));
}

/** The reminders as shown, in order. */
export async function readReminders(page: Page): Promise<string[]> {
  return page.locator("li[data-kind='rem'] .title").allTextContents();
}

/** `manually_positioned` of the task with this title, read-only while the app runs. */
export function readMark(dataDir: string, title: string): number | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select manually_positioned as m from tasks where title_md = ?").get(title) as { m: number } | undefined;
    return row?.m;
  } finally {
    db.close();
  }
}

/** `updated_at` of the task with this title (FR-003: a cancelled drag saves nothing). */
export function readUpdatedAt(dataDir: string, title: string): number | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("select updated_at as u from tasks where title_md = ?").get(title) as { u: number } | undefined;
    return row?.u;
  } finally {
    db.close();
  }
}

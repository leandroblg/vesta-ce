import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedAsset, seedReminders, seedSearchSet, seedTasks, task } from "./fixtures/seed";
import { searchBox, searchSettled } from "./fixtures/search";
import { createHash } from "node:crypto";
import type { Task } from "../../src/domain/task";
import { clickRevealed } from "./fixtures/hover";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readIndicator } from "./fixtures/drag";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { exportFolder, nextDialog, notice } from "./fixtures/export";
import { openSettings } from "./fixtures/settings";
import { entriesFor, seedLogs } from "./fixtures/logs";
import { backToTasks } from "./fixtures/nav";

function thousandTasks(): Task[] {
  const rows: Task[] = [];
  for (let i = 0; i < 500; i++) {
    const parent = task({ titleMd: `Parent ${String(i)}`, position: i + 1 });
    rows.push(parent);
    if (i < 300) rows.push(task({ titleMd: `Child ${String(i)}`, parentId: parent.id, position: 1 }));
  }
  for (let i = 0; i < 200; i++) rows.push(task({ titleMd: `Single ${String(i)}`, position: 1000 + i }));
  return rows; // 1,000 active rows
}

/** Time in the renderer from running `act` until `done` is true on a frame (SC-003). */
async function timeInPage(page: Page, act: string, done: string): Promise<number> {
  const script = `(async () => {
    const start = performance.now();
    ${act};
    while (!(${done})) await new Promise((r) => requestAnimationFrame(r));
    return performance.now() - start;
  })()`;
  return page.evaluate<number>(script);
}

test.describe("performance budgets (constitution VI)", () => {
  test("1,000 tasks and 200 reminders: usable main view in under 2 s; each action shows in under 100 ms (SC-002, SC-003; 002 SC-005)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, thousandTasks());
    seedReminders(dataDir, Array.from({ length: 200 }, (_, i) => reminder({ textMd: `Rem ${String(i)}`, position: i + 1 })));
    const started = performance.now();
    const { app, page } = await launchVesta({ dataDir });
    const ready = performance.now() - started;
    try {
      await expect(page.locator("li[data-kind='task']")).toHaveCount(1000);
      await expect(page.locator("li[data-kind='rem']")).toHaveCount(200);
      expect(ready).toBeLessThan(2000);

      await page.getByRole("button", { name: "New task…" }).click();
      const editor = page.getByRole("textbox", { name: "New task…" });
      await editor.fill("Perf add");
      const add = await timeInPage(
        page,
        `document.querySelector("[role='textbox'][aria-label='New task…']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`,
        `[...document.querySelectorAll("li[data-kind='task'] .title")].some((e) => e.textContent === "Perf add")`,
      );
      await editor.press("Escape");

      const done = await timeInPage(
        page,
        `document.querySelector("input[aria-label='Mark done: Single 5']").click()`,
        `document.querySelector("input[aria-label='Mark done: Single 5']") === null`,
      );

      await page.locator("li[data-kind='task']").filter({ hasText: /^Single 7$/ }).locator(".title").dblclick();
      await page.locator("li[data-kind='task'] [role='textbox']").fill("Single 7 edited");
      const edit = await timeInPage(
        page,
        `document.querySelector("li[data-kind='task'] [role='textbox']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`,
        `[...document.querySelectorAll("li[data-kind='task'] .title")].some((e) => e.textContent === "Single 7 edited")`,
      );

      const del = await timeInPage(
        page,
        `document.querySelector("input[aria-label='Mark done: Single 9']").closest("li").querySelector("button[aria-label='More actions']").click()`,
        `document.querySelector("[role='menuitem'].danger") !== null`,
      );
      const delAction = await timeInPage(
        page,
        `document.querySelector("[role='menuitem'].danger").click()`,
        `document.querySelector("input[aria-label='Mark done: Single 9']") === null`,
      );

      // 002 SC-005: reminder actions with 200 reminders and 1,000 tasks. Done first: at 200 the empty card is the limit card.
      const remDone = await timeInPage(
        page,
        `document.querySelector("input[aria-label='Mark done: Rem 5']").click()`,
        `document.querySelector("input[aria-label='Mark done: Rem 5']") === null`,
      );
      await page.getByTestId("notification").getByRole("button", { name: "Close" }).click({ force: true });
      await page.getByRole("button", { name: "New reminder…" }).click();
      await page.getByRole("textbox", { name: "New reminder…" }).fill("Perf reminder");
      const remAdd = await timeInPage(
        page,
        `document.querySelector("[role='textbox'][aria-label='New reminder…']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`,
        `[...document.querySelectorAll("li[data-kind='rem'] .title")].some((e) => e.textContent === "Perf reminder")`,
      );
      await page.locator("li[data-kind='rem']").filter({ hasText: /^Rem 7$/ }).locator(".title").dblclick();
      await page.locator("li[data-kind='rem'] [role='textbox']").fill("Rem 7 edited");
      const remEdit = await timeInPage(
        page,
        `document.querySelector("li[data-kind='rem'] [role='textbox']").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`,
        `[...document.querySelectorAll("li[data-kind='rem'] .title")].some((e) => e.textContent === "Rem 7 edited")`,
      );
      const remDelete = await timeInPage(
        page,
        `document.querySelector("input[aria-label='Mark done: Rem 9']").closest("li").querySelector("button[aria-label='Move to Trash']").click()`,
        `document.querySelector("input[aria-label='Mark done: Rem 9']") === null`,
      );

      for (const [name, ms] of Object.entries({ add, done, edit, menu: del, delete: delAction, remDone, remAdd, remEdit, remDelete })) {
        expect(ms, `${name} took ${ms.toFixed(1)} ms`).toBeLessThan(100);
      }
    } finally {
      await app.close();
    }
  });

  test("018 T066: 1,000 tasks with 500 in the Archive and 200 in the Trash past both cleanups: usable in under 2 s, the purge after the first paint", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const year = 365 * 86_400_000;
    const rows: Task[] = [];
    for (let i = 0; i < 300; i++) rows.push(task({ titleMd: `Active ${String(i)}`, position: i + 1 }));
    for (let i = 0; i < 500; i++) rows.push(task({ titleMd: `Old done ${String(i)}`, position: 1000 + i, doneAt: now - 11 * year, updatedAt: now - 11 * year }));
    for (let i = 0; i < 200; i++) rows.push(task({ titleMd: `Old gone ${String(i)}`, position: 2000 + i, deletedAt: now - 40 * 86_400_000 }));
    seedTasks(dataDir, rows);
    const started = performance.now();
    const { app, page } = await launchVesta({ dataDir });
    const ready = performance.now() - started;
    try {
      await expect(page.locator("li[data-kind='task']")).toHaveCount(300);
      expect(ready).toBeLessThan(2000);
      await expect.poll(() => entriesFor(dataDir, "purge.removed").map((e) => e["count"])).toEqual([700]);
      const purgedAt = Date.parse(entriesFor(dataDir, "purge.removed")[0]?.time ?? "");
      const paintedAt = await page.evaluate(() => {
        const paint = performance.getEntriesByType("paint")[0];
        return paint === undefined ? Number.NaN : performance.timeOrigin + paint.startTime;
      });
      expect(Number.isFinite(paintedAt)).toBe(true);
      expect(purgedAt).toBeGreaterThanOrEqual(Math.floor(paintedAt));
      console.log(`018 T066 start ${String(Math.round(ready))} ms; purge ${String(Math.round(purgedAt - paintedAt))} ms after the first paint`);
    } finally {
      await app.close();
    }
  });

  test("1,000 tasks of which 200 are stale: under 2 s to a usable view; a tick and a Reschedule under 100 ms; no long task on the minute update (003 SC-008)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const day = 86_400_000;
    let top = 0;
    const rows = thousandTasks().map((t) => {
      if (t.parentId !== null || top >= 200) return t;
      const i = top++;
      const created = now - 2 * day - i * 60_000;
      return { ...t, titleMd: `Stale ${String(i)}`, createdAt: created, staleBaseAt: created, staleSince: created + day, wasStale: true, firstBlinkCount: 3 as const, lastBlinkAt: now };
    });
    const staleCount = rows.filter((t) => t.staleSince !== null).length;
    seedTasks(dataDir, rows);
    const started = performance.now();
    const { app, page } = await launchVesta({ dataDir });
    const ready = performance.now() - started;
    try {
      await expect(page.locator("li[data-kind='task']")).toHaveCount(1000);
      await expect(page.locator("li[data-kind='task'].stale")).toHaveCount(staleCount);
      expect(staleCount).toBe(200);
      expect(ready).toBeLessThan(2000);

      await page.evaluate(() => {
        const w = window as unknown as { __longTasks: number[] };
        w.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.__longTasks.push(e.duration);
        }).observe({ type: "longtask", buffered: false });
      });
      const tickMs = await timeInPage(
        page,
        `window.__n = Number(document.documentElement.dataset.alertTicks ?? "0"); window.dispatchEvent(new Event("focus"))`,
        `Number(document.documentElement.dataset.alertTicks ?? "0") > window.__n`,
      );
      await page.waitForTimeout(300);
      const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);

      const first = page.locator("li[data-kind='task'].stale:not(.sub)").first();
      const title = (await first.locator(".title").textContent()) ?? "";
      await first.hover();
      const resched = await timeInPage(
        page,
        `[...document.querySelectorAll("li[data-kind='task']")].find((li) => li.querySelector(".title")?.textContent === ${JSON.stringify(title)}).querySelector("button.resched").click()`,
        `![...document.querySelectorAll("li[data-kind='task']")].find((li) => li.querySelector(".title")?.textContent === ${JSON.stringify(title)}).classList.contains("stale")`,
      );

      expect(tickMs, `tick took ${tickMs.toFixed(1)} ms`).toBeLessThan(100);
      expect(resched, `reschedule took ${resched.toFixed(1)} ms`).toBeLessThan(100);
      expect(longTasks.filter((d) => d > 50), "long tasks over 50 ms during the tick").toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("20 force-quit trials covering every kind of change lose nothing saved 500 ms before the kill (SC-004)", async () => {
    test.setTimeout(300_000);
    const dataDir = freshDataDir();
    type Kind = "edit" | "done" | "restore" | "delete" | "permanent" | "collapse" | "undo" | "add";
    const kinds: Kind[] = ["edit", "done", "restore", "delete", "permanent", "collapse", "undo", "add"];
    const active = new Set<string>();
    const archived: string[] = [];
    const trashed: string[] = [];
    let collapsedParent: string | null = null;

    const row = (page: Page, title: string) =>
      page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
    const topTitles = (page: Page) => page.locator("li[data-kind='task']:not(.sub) .title");
    const sorted = (xs: Iterable<string>) => [...xs].sort();

    async function verify(page: Page) {
      expect(sorted(await topTitles(page).allTextContents())).toEqual(sorted(active));
      await expect(page.getByRole("button", { name: /^Archive/ })).toContainText(String(archived.length));
      await expect(page.getByRole("button", { name: /^Trash/ })).toContainText(String(trashed.length));
      if (collapsedParent !== null) {
        await expect(row(page, collapsedParent).getByRole("button", { name: /Collapse|Expand/ })).toHaveAttribute("aria-expanded", "false");
      }
    }

    for (let trial = 1; trial <= 20; trial++) {
      const { app, page } = await launchVesta({ dataDir });
      await verify(page);
      const title = `Trial ${String(trial)}`;
      await page.getByRole("button", { name: "New task…" }).click();
      const editor = page.getByRole("textbox", { name: "New task…" });
      await editor.fill(title);
      await editor.press("Enter");
      await editor.press("Escape");
      active.add(title);

      const kind = kinds[(trial - 1) % kinds.length] ?? "add";
      if (kind === "edit") {
        await row(page, title).locator(".title").dblclick();
        await page.locator("li[data-kind='task'] [role='textbox']").fill(`${title} edited`);
        await page.locator("li[data-kind='task'] [role='textbox']").press("Enter");
        active.delete(title);
        active.add(`${title} edited`);
        await expect(row(page, `${title} edited`)).toBeVisible();
      } else if (kind === "done") {
        await row(page, title).getByRole("checkbox").click();
        active.delete(title);
        archived.push(title);
        await expect(row(page, title)).toHaveCount(0);
      } else if (kind === "restore" && archived.length > 0) {
        const back = archived.pop() ?? "";
        await page.getByRole("button", { name: /^Archive/ }).click();
        await page.getByRole("button", { name: `Restore: ${back}` }).click();
        await backToTasks(page);
        active.add(back);
        await expect(row(page, back)).toBeVisible();
      } else if (kind === "delete") {
        await clickRevealed(row(page, title), row(page, title).getByRole("button", { name: "More actions" }));
        await page.getByRole("menuitem", { name: "Move to Trash" }).click();
        active.delete(title);
        trashed.push(title);
        await expect(row(page, title)).toHaveCount(0);
      } else if (kind === "permanent" && trashed.length > 0) {
        const gone = trashed.pop() ?? "";
        await page.getByRole("button", { name: /^Trash/ }).click();
        await page.getByRole("button", { name: `Delete permanently: ${gone}` }).click();
        await page.getByRole("button", { name: `Click again to delete: ${gone}` }).click();
        await backToTasks(page);
        await expect(page.getByRole("button", { name: /^Trash/ })).toContainText(String(trashed.length));
      } else if (kind === "collapse") {
        await clickRevealed(row(page, title), row(page, title).getByRole("button", { name: "More actions" }));
        await page.getByRole("menuitem", { name: "New Subtask" }).click();
        const sub = page.getByRole("textbox", { name: "New subtask…" });
        await sub.fill(`${title} step`);
        await sub.press("Enter");
        await sub.press("Escape");
        await row(page, title).getByRole("button", { name: "Collapse" }).click();
        collapsedParent = title;
        await expect(row(page, `${title} step`)).toHaveCount(0);
      } else if (kind === "undo") {
        await row(page, title).getByRole("checkbox").click();
        await page.getByTestId("notification").getByRole("button", { name: "Undo" }).click();
        await expect(row(page, title)).toBeVisible();
      }

      await page.waitForTimeout(500);
      app.process().kill("SIGKILL");
    }
    const { app, page } = await launchVesta({ dataDir });
    try {
      await verify(page);
    } finally {
      await app.close();
    }
  });

  test("004 SC-004: dragging across 1,000 rows (100 stale) with auto-scroll stays smooth; the drop and a keyboard move show in under 100 ms", async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    const now = Date.now();
    const day = 86_400_000;
    let top = 0;
    const rows = thousandTasks().map((t) => {
      if (t.parentId !== null || top >= 100) return t;
      const i = top++;
      const created = now - 2 * day - i * 60_000;
      return { ...t, titleMd: `Stale ${String(i)}`, createdAt: created, staleBaseAt: created, staleSince: created + day, wasStale: true, firstBlinkCount: 3 as const, lastBlinkAt: now };
    });
    seedTasks(dataDir, rows);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(page.locator("li[data-kind='task']")).toHaveCount(1000);
      const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      // Frame recorder: every animation frame's time while the drag runs.
      await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __recording: boolean };
        w.__frames = [];
        w.__recording = true;
        const loop = (t: number) => {
          w.__frames.push(t);
          if (w.__recording) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const first = page.locator("li[data-kind='task']").first();
      await dragTo(page, first, { point: { x: viewport.width / 2, y: viewport.height - 6 } }, { release: false, steps: 30 });
      // Auto-scroll for 2 s at the bottom edge, then the wheel takes the list to its end (as a user would).
      await page.waitForTimeout(2000);
      await page.mouse.wheel(0, 100_000);
      await page.waitForFunction(() => {
        const main = document.querySelector(".main");
        return main !== null && main.scrollTop + main.clientHeight >= main.scrollHeight - 2;
      });
      const empty = await page.locator("li[data-kind='new-task']").boundingBox();
      if (empty === null) throw new Error("empty card not visible");
      await page.mouse.move(empty.x + empty.width / 2, empty.y + empty.height / 2, { steps: 10 });
      await expect.poll(() => readIndicator(page)).toBe("line-top");
      const frames = await page.evaluate(() => {
        const w = window as unknown as { __frames: number[]; __recording: boolean };
        w.__recording = false;
        return w.__frames;
      });
      const gaps = frames.slice(1).map((t, i) => t - (frames[i] as number));
      const longest = Math.max(...gaps);
      const fps = (1000 * gaps.length) / ((frames.at(-1) as number) - (frames[0] as number));
      const title = (await first.locator(".title").textContent()) ?? "";
      // The result shows after release: time from just before mouse up until the moved row is last.
      await page.evaluate((t) => {
        const w = window as unknown as { __dropMs?: number };
        const start = performance.now();
        const check = () => {
          const titles = [...document.querySelectorAll("li[data-kind='task']:not(.sub) .title")];
          if (titles.at(-1)?.textContent === t) w.__dropMs = performance.now() - start;
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, title);
      await page.mouse.up();
      await page.waitForFunction(() => (window as unknown as { __dropMs?: number }).__dropMs !== undefined);
      const dropMs = await page.evaluate(() => (window as unknown as { __dropMs: number }).__dropMs);

      // A keyboard move near the end of the list.
      const near = taskCard(page, "Single 195");
      await near.getByRole("checkbox").focus();
      const keyMs = await timeInPage(
        page,
        `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }))`,
        `document.activeElement?.closest("li")?.nextElementSibling?.querySelector(".title")?.textContent !== "Single 196" && document.activeElement?.closest("li")?.previousElementSibling?.querySelector(".title")?.textContent === "Single 196"`,
      );

      expect(longest, `longest frame ${longest.toFixed(1)} ms`).toBeLessThanOrEqual(50);
      expect(fps, `average ${fps.toFixed(1)} fps`).toBeGreaterThanOrEqual(50);
      expect(dropMs, `drop shown after ${dropMs.toFixed(1)} ms`).toBeLessThan(100);
      expect(keyMs, `keyboard move shown after ${keyMs.toFixed(1)} ms`).toBeLessThan(100);
    } finally {
      await app.close();
    }
  });

  test("005 SC-003: 1,000 formatted titles (100 with an image): usable in under 2 s, smooth scrolling, panel and inline editor in under 200 ms, one editor at a time", async () => {
    const dataDir = freshDataDir();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC", "base64");
    const image = `assets/${createHash("sha256").update(png).digest("hex")}.png`;
    const rows = Array.from({ length: 1000 }, (_, i) =>
      task({
        position: i + 1,
        titleMd:
          i % 10 === 0
            ? `Row ${String(i)} ![photo.png](${image}) **bold**`
            : i % 3 === 0
              ? `**Row** ${String(i)} [colored]{color="#dd3333ff"} ==mark== ~~old~~ \`code\``
              : `Plain row ${String(i)}`,
      }),
    );
    seedTasks(dataDir, rows);
    seedAsset(dataDir, png, "png", "image/png");
    const started = performance.now();
    const { app, page } = await launchVesta({ dataDir });
    const ready = performance.now() - started;
    try {
      await expect(page.locator("li[data-kind='task']")).toHaveCount(1000);
      expect(ready).toBeLessThan(2000);
      await expect(page.locator("li[data-kind='task'] .title img")).toHaveCount(100);
      expect(await page.evaluate(() => document.querySelectorAll(".ProseMirror").length)).toBe(0);

      const longest = await page.evaluate(async () => {
        const main = document.querySelector(".main");
        if (!main) throw new Error("no main");
        let last = performance.now();
        let worst = 0;
        for (let guard = 0; guard < 400 && main.scrollTop + main.clientHeight < main.scrollHeight - 2; guard++) {
          const before = main.scrollTop;
          main.scrollTop += 600;
          if (main.scrollTop === before) break;
          await new Promise((r) => requestAnimationFrame(r));
          const now = performance.now();
          worst = Math.max(worst, now - last);
          last = now;
        }
        return worst;
      });
      console.log("SC-003 measurements:", JSON.stringify({ ready: Math.round(ready), longestFrame: Math.round(longest) }));
      expect(longest).toBeLessThan(50);

      await page.evaluate(() => document.querySelector(".main")?.scrollTo(0, 0));
      const panel = await timeInPage(
        page,
        `document.querySelector("li[data-kind='task'] .title").click()`,
        `document.querySelectorAll("[data-testid='details-panel'] .ProseMirror").length === 2`,
      );
      console.log("SC-003 panel:", Math.round(panel));
      expect(panel).toBeLessThan(200 + 230); // the 230 ms double-click wait comes first (FR-001)
      expect(await page.evaluate(() => document.querySelectorAll(".ProseMirror").length)).toBe(2);
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => document.querySelectorAll(".ProseMirror").length)).toBe(0);

      const inline = await timeInPage(
        page,
        `document.querySelectorAll("li[data-kind='task'] .title")[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`,
        `document.querySelectorAll("li[data-kind='task'] .ProseMirror").length === 1`,
      );
      console.log("SC-003 inline:", Math.round(inline));
      expect(inline).toBeLessThan(200);
      expect(await page.evaluate(() => document.querySelectorAll(".ProseMirror").length)).toBe(1);
      await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => document.querySelectorAll(".ProseMirror").length)).toBe(0);
    } finally {
      await app.close();
    }
  });
  test("006 SC-001: results on screen within 100 ms of each keystroke on the research §5 data set", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      for (const include of [false, true]) {
        if (include) await page.getByRole("radio", { name: "Everything" }).click();
        await searchBox(page).fill("");
        // Typed one character at a time; each timed from the input event to the settled, painted results.
        const times = await page.evaluate(async () => {
          const el = document.getElementById("search") as HTMLInputElement;
          // The native setter, so React sees the change as typing (a plain assignment would be ignored).
          const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
          const settled = () => {
            const d = document.documentElement.dataset;
            return d["searchSent"] !== undefined && d["searchSeq"] === d["searchSent"] && d["searchPending"] === "false";
          };
          const frame = () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                resolve();
              });
            });
          for (let k = 0; k < 10; k++) await frame();
          const out: { text: string; ms: number; rows: number }[] = [];
          for (const text of ["q", "qu", "qua", "quar", "quart", "quarte", "quarter", "quarterl", "quarterly"]) {
            const t0 = performance.now();
            desc?.set?.call(el, text);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            while (!settled()) await frame();
            await frame();
            out.push({ text, ms: Math.round(performance.now() - t0), rows: document.querySelectorAll("li[data-kind='task'], li.arow").length });
          }
          return out;
        });
        console.log(`006 SC-001 keystroke-to-screen, checkbox ${include ? "on" : "off"}: ${JSON.stringify(times)}`);
        // SC-001 as amended (spec Assumptions): within a search every keystroke stays under
        // 100 ms, the filtered lists being virtualized (`rows` counts rendered rows); the keystroke that switches
        // the 1,000-row list into the search view may take up to 180 ms.
        const [first, ...rest] = times;
        for (const t of rest) expect(t.ms, `${t.text} (${String(t.rows)} rendered rows)`).toBeLessThan(100);
        if (first !== undefined) expect(first.ms, `${first.text} (entering the search view)`).toBeLessThan(180);
      }
      // Typing fast loses no character.
      await searchBox(page).fill("");
      await searchBox(page).pressSequentially("quarterly report", { delay: 10 });
      await expect(searchBox(page)).toHaveValue("quarterly report");
      await searchSettled(page);
    } finally {
      await app.close();
    }
  });

  test("006 research §4: the first start after the update indexes the research §5 data set in under 3 s with the worker pool", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir, { version: 4 });
    const started = Date.now();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await searchBox(page).fill("quarterly");
      await searchSettled(page);
      const ms = Date.now() - started;
      console.log(`006 first-start fill, launch to complete results (ms): ${String(ms)}`);
      expect(ms).toBeLessThan(3000 + 2000);
    } finally {
      await app.close();
    }
  });

  test("007: with 1,000 tasks, a language switch re-renders the open view within 100 ms; start stays under 2 s", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir);
    const started = performance.now();
    const { app, page } = await launchVesta({ dataDir });
    const ready = performance.now() - started;
    try {
      expect(ready, `ready after ${ready.toFixed(0)} ms`).toBeLessThan(2000);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
      await page.locator("#set-language").waitFor();
      const ms = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const select = document.querySelector<HTMLSelectElement>("#set-language");
            const heading = document.querySelector("#tasks-h");
            if (select === null || heading === null) {
              resolve(Number.POSITIVE_INFINITY);
              return;
            }
            const start = performance.now();
            const check = () => {
              if (heading.textContent === "Tâches") resolve(performance.now() - start);
              else requestAnimationFrame(check);
            };
            select.value = "fr";
            select.dispatchEvent(new Event("change", { bubbles: true }));
            requestAnimationFrame(check);
          }),
      );
      expect(ms, `language switch took ${ms.toFixed(1)} ms`).toBeLessThan(100);
    } finally {
      await app.close();
    }
  });

  test("008 SC-005: 1,000 tasks, 200 reminders and 50 files (200 MB): export under 15 s, import under 20 s, the window keeps responding", async () => {
    test.setTimeout(240_000);
    const dataDir = freshDataDir();
    const files = Array.from({ length: 50 }, (_, i) => {
      const bytes = Buffer.alloc(4 * 1024 * 1024, i);
      bytes.writeUInt32BE(i, 0);
      return bytes;
    });
    const refs = files.map((b) => `assets/${createHash("sha256").update(b).digest("hex")}.bin`);
    const rows = thousandTasks().map((t, i) => (i < 50 ? { ...t, detailsMd: `[file ${String(i)}](${refs[i] ?? ""})` } : t));
    seedTasks(dataDir, rows);
    for (const bytes of files) seedAsset(dataDir, bytes, "bin");
    seedReminders(dataDir, Array.from({ length: 200 }, (_, i) => reminder({ textMd: `Rem ${String(i)}`, position: i + 1 })));

    /** Samples animation frames until `done` resolves; returns the longest gap in ms. */
    const longestFrameWhile = async (page: Page, done: Promise<unknown>): Promise<number> => {
      const state = { finished: false };
      void done.then(() => {
        state.finished = true;
      });
      let longest = 0;
      while (!state.finished) {
        const gap = await page.evaluate(() => new Promise<number>((r) => {
          const t0 = performance.now();
          requestAnimationFrame(() => {
            r(performance.now() - t0);
          });
        }));
        longest = Math.max(longest, gap);
      }
      return longest;
    };

    const folder = exportFolder();
    const a = await launchVesta({ dataDir });
    try {
      await openSettings(a.page, "Data");
      await nextDialog(a.app, folder);
      const started = performance.now();
      await a.page.getByTestId("export").click();
      const finished = expect(a.page.getByTestId("data-status")).toContainText("Saved", { timeout: 60_000 });
      const longest = await longestFrameWhile(a.page, finished);
      await finished;
      const exportMs = performance.now() - started;
      console.log(`008 SC-005 export: ${exportMs.toFixed(0)} ms, longest frame ${longest.toFixed(1)} ms`);
      expect(exportMs).toBeLessThan(15_000);
      expect(longest).toBeLessThan(100);
    } finally {
      await a.app.close();
    }

    const b = await launchVesta();
    try {
      await openSettings(b.page, "Data");
      await nextDialog(b.app, join(folder, readdirSync(folder)[0] ?? ""));
      const started = performance.now();
      await b.page.getByTestId("import").click();
      const finished = expect(notice(b.page)).toHaveAttribute("data-kind", "importUndo", { timeout: 60_000 });
      const longest = await longestFrameWhile(b.page, finished);
      await finished;
      const importMs = performance.now() - started;
      console.log(`008 SC-005 import: ${importMs.toFixed(0)} ms, longest frame ${longest.toFixed(1)} ms`);
      expect(importMs).toBeLessThan(20_000);
      expect(longest).toBeLessThan(100);
    } finally {
      await b.app.close();
    }
  });

  test("009 SC-003, SC-004: with 50 MiB of logs the viewer shows the newest entries in under 1 s, scrolls without long tasks, and switches level in under 200 ms; the start stays under 2 s", async () => {
    test.setTimeout(180_000);
    const dataDir = freshDataDir();
    seedLogs(dataDir, { numbers: Array.from({ length: 50 }, (_, i) => i + 1), perFile: 100, entryBytes: 10_400, levels: ["info", "info", "warn", "debug", "error"] });
    const started = performance.now();
    const { app, page } = await launchVesta({ dataDir });
    const ready = performance.now() - started;
    try {
      expect(ready, `start took ${ready.toFixed(0)} ms`).toBeLessThan(2000);
      await openSettings(page, "Data");
      const t0 = performance.now();
      await page.getByTestId("logs-open").click();
      await page.getByTestId("log-list").locator("li[data-key]").first().waitFor();
      const openMs = performance.now() - t0;
      expect(openMs, `viewer opened in ${openMs.toFixed(0)} ms`).toBeLessThan(1000);

      await page.evaluate(() => {
        const w = window as unknown as { __longTasks: number[] };
        w.__longTasks = [];
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) w.__longTasks.push(e.duration);
        }).observe({ type: "longtask", buffered: false });
      });
      for (let i = 0; i < 60; i++) {
        await page.getByTestId("log-list").evaluate((el) => {
          el.scrollTop += el.clientHeight;
        });
        await page.waitForTimeout(30);
      }
      const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
      expect(longTasks.filter((d) => d > 100), "long tasks over 100 ms while scrolling").toEqual([]);

      const switchMs = await timeInPage(
        page,
        `const s = document.querySelector("[data-testid='log-level']"); s.value = "error"; s.dispatchEvent(new Event("change", { bubbles: true }))`,
        `[...document.querySelectorAll("[data-testid='log-list'] li[data-key] .lv-level")].length > 0 && [...document.querySelectorAll("[data-testid='log-list'] li[data-key] .lv-level")].every((e) => e.textContent === "Error" || e.textContent === "Fatal")`,
      );
      expect(switchMs, `level switch took ${switchMs.toFixed(1)} ms`).toBeLessThan(200);
      console.log(`009 viewer: start ${ready.toFixed(0)} ms, open ${openMs.toFixed(0)} ms, level switch ${switchMs.toFixed(1)} ms, long tasks ${JSON.stringify(longTasks)}`);
    } finally {
      await app.close();
    }
  });

  test("011 FR-009: with 1,000 colored titles, a theme switch repaints every span in under 50 ms", async () => {
    const dataDir = freshDataDir();
    const colors = ["#f3f4f6ff", "#1f2937ff", "#ef4444ff", "#fcd34dff"];
    const rows = Array.from({ length: 1000 }, (_, i) =>
      task({
        position: i + 1,
        titleMd: `Row ${String(i)} [text]{color="${colors[i % 4] as string}"} [fill]{bg="${colors[(i + 1) % 4] as string}"}`,
      }),
    );
    seedTasks(dataDir, rows);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(page.locator("li[data-kind='task']")).toHaveCount(1000);
      const spans = await page.locator("[data-vesta-span]").count();
      expect(spans).toBeGreaterThanOrEqual(2000);
      const times: number[] = [];
      for (const theme of ["dark", "light", "dark", "light", "dark"] as const) {
        times.push(await page.evaluate((t) => (window as unknown as { __vestaTest: { paintAllMs(x: "light" | "dark"): number } }).__vestaTest.paintAllMs(t), theme));
      }
      const median = [...times].sort((a, b) => a - b)[2] as number;
      console.info(`[011 T059] theme repaint of ${String(spans)} spans: median ${median.toFixed(1)} ms (${times.map((x) => x.toFixed(1)).join(", ")})`);
      expect(median).toBeLessThan(50);
    } finally {
      await app.close();
    }
  });

  test("011 US2-14: with 1,000 tasks holding older color forms, the start stays under 2 s with the one-time rewrite and on the next start without it", async () => {
    const dataDir = freshDataDir();
    seedTasks(
      dataDir,
      Array.from({ length: 1000 }, (_, i) =>
        task({ position: i + 1, titleMd: `Row ${String(i)} [a]{color="#d33"} [b]{bg="#ffe066"}`, detailsMd: `[c]{color="#ffe06680"} text` }),
      ),
    );
    const times: number[] = [];
    for (let run = 0; run < 2; run++) {
      const started = performance.now();
      const { app, page } = await launchVesta({ dataDir });
      try {
        await expect(page.locator("li[data-kind='task']")).toHaveCount(1000);
        times.push(performance.now() - started);
      } finally {
        await app.close();
      }
    }
    console.info(`[011 T086] start with the rewrite ${(times[0] as number).toFixed(0)} ms, next start ${(times[1] as number).toFixed(0)} ms`);
    for (const ms of times) expect(ms).toBeLessThan(2000);
  });
});

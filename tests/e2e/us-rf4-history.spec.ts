/**
 * 015 User Story 3: the created time and the history, in both panels, across languages, an old database, export and
 * import (FR-015 to FR-024, SC-004, SC-005; PRD Q206, Q208, Q210, Q214–Q217; ui.md "Details panel status").
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { DAY, MIN, advanceClock, tick } from "./fixtures/clock";
import { exportFolder, exportVia, importVia } from "./fixtures/export";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings, setLanguage } from "./fixtures/settings";

interface EventRow {
  id: string;
  task_id: string;
  kind: string;
  at: number;
  detail: number | null;
}

function events(dataDir: string): EventRow[] {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return db.prepare("select id, task_id, kind, at, detail from task_events order by at, rowid").all() as EventRow[];
  } finally {
    db.close();
  }
}

const historyItems = (page: Page) => page.locator(".panel-history li");
const historyKinds = (page: Page) => historyItems(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));

async function openMenu(page: Page, title: string) {
  const card = taskCard(page, title);
  await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
}

async function newTask(page: Page, title: string) {
  const editor = page.getByRole("textbox", { name: "New task…" });
  if (!(await editor.isVisible())) await page.getByRole("button", { name: "New task…" }).click();
  await editor.fill(title);
  await editor.press("Enter");
  await page.keyboard.press("Escape");
  await expect(taskCard(page, title)).toBeVisible();
}

async function settle(page: Page) {
  await tick(page);
  await waitBlinksDone(page);
}

test.describe("015 US3 — task history and created time", () => {
  test("every event, newest first, with its date and time; the read-only Trash panel lists the same (scenarios 1, 2; FR-021)", async () => {
    test.setTimeout(120_000);
    const { app, page, dataDir } = await launchVesta();
    try {
      await newTask(page, "Passport");
      const card = taskCard(page, "Passport");
      const id = (await card.getAttribute("data-id")) ?? "";
      // Created shows its time too (scenario 1).
      await card.locator(".title").click();
      const created = page.locator(".meta-grid time").first();
      await expect(created).toHaveText(/ at \d{1,2}:\d{2}/);
      await page.keyboard.press("Escape");

      await advanceClock(app, DAY + MIN);
      await settle(page);
      await expect(card).toHaveClass(/\bstale\b/);
      await openMenu(page, "Passport");
      await page.getByRole("menuitem", { name: "Postpone For" }).click();
      await page.getByRole("menu", { name: "Postpone For" }).getByRole("menuitem", { name: "2h" }).click();

      await advanceClock(app, MIN);
      await openMenu(page, "Passport");
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      const override = page.getByRole("dialog", { name: "Alert override" });
      await override.getByRole("checkbox").click();
      await expect.poll(() => events(dataDir).map((e) => e.kind)).toContain("override_set");
      await advanceClock(app, 2 * MIN);
      await override.getByRole("checkbox").click();
      await expect.poll(() => events(dataDir).map((e) => e.kind)).toContain("override_cleared");
      await page.keyboard.press("Escape");

      await advanceClock(app, MIN);
      await card.getByRole("checkbox").click();
      await advanceClock(app, MIN);
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator("li.arow", { hasText: "Passport" }).getByRole("button", { name: /Restore/ }).click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await advanceClock(app, MIN);
      await openMenu(page, "Passport");
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();

      await expect.poll(() => events(dataDir).filter((e) => e.task_id === id).map((e) => e.kind)).toEqual([
        "created",
        "stale",
        "rescheduled",
        "override_set",
        "override_cleared",
        "done",
        "restored",
        "trashed",
      ]);
      await page.getByRole("button", { name: /^Trash/ }).click();
      await page.locator("li.arow", { hasText: "Passport" }).locator(".title").click();
      await expect.poll(() => historyKinds(page)).toEqual([
        "trashed",
        "restored",
        "done",
        "override_cleared",
        "override_set",
        "rescheduled",
        "stale",
        "created",
      ]);
      await expect(historyItems(page).locator("time")).toHaveCount(8);
      await expect(historyItems(page).filter({ hasText: "Rescheduled for 2h" })).toHaveCount(1);
      await expect(historyItems(page).filter({ hasText: "Alert period set to 1d" })).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test("override edits within a minute make one entry; Undo after Mark as Done leaves no done entry (FR-016a, FR-019)", async () => {
    const { app, page, dataDir } = await launchVesta();
    try {
      await newTask(page, "Bike");
      const card = taskCard(page, "Bike");
      const id = (await card.getAttribute("data-id")) ?? "";
      await openMenu(page, "Bike");
      await page.getByRole("menuitem", { name: "Alert Period…" }).click();
      const override = page.getByRole("dialog", { name: "Alert override" });
      await override.getByRole("checkbox").click();
      const days = override.getByRole("spinbutton", { name: "Days" });
      await days.fill("3");
      await page.waitForTimeout(700);
      await override.getByRole("spinbutton", { name: "Hours" }).fill("4");
      await page.waitForTimeout(700);
      await page.keyboard.press("Escape");
      await expect.poll(() => events(dataDir).filter((e) => e.task_id === id && e.kind.startsWith("override")).map((e) => [e.kind, e.detail])).toEqual([
        ["override_set", 3 * 1440 + 4 * 60],
      ]);

      await card.getByRole("checkbox").click();
      await expect.poll(() => events(dataDir).filter((e) => e.task_id === id).map((e) => e.kind)).toContain("done");
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(card).toBeVisible();
      await expect.poll(() => events(dataDir).filter((e) => e.task_id === id).map((e) => e.kind)).toEqual(["created", "override_set"]);
    } finally {
      await app.close();
    }
  });

  test("a task that went stale while the app was closed records the real moment; a longer period records No longer stale (scenario 3; Q216)", async () => {
    const dataDir = freshDataDir();
    let run = await launchVesta({ dataDir });
    let id = "";
    let createdAt: number;
    try {
      await newTask(run.page, "Taxes");
      id = (await taskCard(run.page, "Taxes").getAttribute("data-id")) ?? "";
      createdAt = events(dataDir).find((e) => e.task_id === id)?.at ?? 0;
    } finally {
      await run.app.close();
    }
    run = await launchVesta({ dataDir, env: { VESTA_CLOCK_OFFSET_MIN: String(3 * 24 * 60) } });
    try {
      await settle(run.page);
      await expect.poll(() => events(dataDir).find((e) => e.task_id === id && e.kind === "stale")?.at).toBe(createdAt + DAY);
      await openSettings(run.page, "Alerts");
      const field = dialog(run.page).getByRole("group", { name: "Default alert period" }).getByRole("spinbutton", { name: "Days" });
      await field.fill("10");
      await expect.poll(() => events(dataDir).filter((e) => e.task_id === id).map((e) => e.kind)).toContain("unstale");
      await closeSettings(run.page);
      await taskCard(run.page, "Taxes").locator(".title").click();
      await expect(historyItems(run.page).filter({ hasText: "No longer stale (alert period changed)" })).toHaveCount(1);
    } finally {
      await run.app.close();
    }
  });

  test("in each language the labels and times follow; an old done task shows Created, Done and a dateless Was stale (scenarios 4, 6; FR-020)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [task({ titleMd: "Old one", createdAt: now - 5 * DAY, doneAt: now - DAY, wasStale: true, staleSince: null })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator("li.arow", { hasText: "Old one" }).locator(".title").click();
      await expect.poll(() => historyKinds(page)).toEqual(["done", "wasStale", "created"]);
      await expect(historyItems(page).filter({ hasText: "Was stale" }).locator("time")).toHaveCount(0);
      for (const [lang, created] of [
        ["pt-BR", "Criada"],
        ["it", "Creata"],
        ["es-ES", "Creada"],
        ["fr", "Créée"],
        ["en", "Created"],
      ] as const) {
        await setLanguage(page, lang, lang);
        await expect(historyItems(page).last()).toContainText(created);
      }
    } finally {
      await app.close();
    }
  });

  test("export, import on a fresh profile: the same history; importing again adds nothing (scenario 5, SC-005)", async () => {
    test.setTimeout(120_000);
    const source = freshDataDir();
    const a = await launchVesta({ dataDir: source });
    const folder = exportFolder();
    try {
      await newTask(a.page, "Keep me");
      await openMenu(a.page, "Keep me");
      await a.page.getByRole("menuitem", { name: "Reschedule", exact: true }).click();
      await expect.poll(() => events(source).length).toBe(2);
      await exportVia(a.app, a.page, folder);
    } finally {
      await a.app.close();
    }
    const zip = join(folder, readdirSync(folder)[0] ?? "");
    const original = events(source);
    const b = await launchVesta();
    try {
      expect(await importVia(b.app, b.page, zip)).toBe("merged");
      expect(events(b.dataDir)).toEqual(original);
      await settle(b.page);
      expect(await importVia(b.app, b.page, zip)).toBe("merged");
      expect(events(b.dataDir)).toEqual(original);
    } finally {
      await b.app.close();
    }
  });
});

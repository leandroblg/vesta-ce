// 008 US3: merge an export into data I already have (US3-1 to US3-11; quickstart 13–15; FR-031 to FR-042;
// tasks T053).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { toExportJson } from "../../src/domain/export/format";
import type { Task } from "../../src/domain/task";
import { writeZip } from "../unit/fixtures/zip";
import { snapshotDiff } from "../unit/fixtures/export-compare";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { exportFolder, exportVia, importVia, notice, snapshotOf } from "./fixtures/export";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { DAY, addTasks, reminder, seedReminders, seedSetting, seedSettings, task } from "./fixtures/seed";
import { IS_MAC } from "./fixtures/settings";

const T0 = Date.now() - 10 * DAY;
const SHARED = "00000000-0000-4000-8000-0000000000aa";

/** Exports a data folder through the UI and returns the zip's path. */
async function exportOf(dataDir: string): Promise<string> {
  const { app, page } = await launchVesta({ dataDir });
  const folder = exportFolder();
  try {
    await exportVia(app, page, folder);
  } finally {
    await app.close();
  }
  return join(folder, readdirSync(folder)[0] ?? "");
}

function shared(overrides: Partial<Task>): Task {
  return task({ id: SHARED, titleMd: "Shared", createdAt: T0, staleBaseAt: T0, updatedAt: T0, ...overrides });
}

const mergedText = (a: number, u: number, s: number) =>
  `Merged: ${String(a)} added, ${String(u)} updated, ${String(s)} unchanged because the local version was the same or newer. A backup from just before the import was kept.`;

async function expectNotice(page: Page, a: number, u: number, s: number): Promise<void> {
  await expect(notice(page)).toContainText(mergedText(a, u, s));
}

test.describe("008 US3 — merge into existing data", () => {
  test("newest wins both ways; field for field; local-only untouched; the exact message (US3-1 to US3-4, US3-7)", async () => {
    const a = freshDataDir();
    const b = freshDataDir();
    const localOnly = task({ titleMd: "Only in A", createdAt: T0, updatedAt: T0 });
    addTasks(a, [shared({ titleMd: "A edit", updatedAt: T0 + 10_000, alertOverrideMin: 120 }), localOnly]);
    addTasks(b, [shared({ titleMd: "B edit", updatedAt: T0 + 20_000, alertOverrideMin: null }), task({ titleMd: "Only in B", createdAt: T0 })]);
    const zipA = await exportOf(a);
    const zipB = await exportOf(b);

    const intoA = await launchVesta({ dataDir: a });
    try {
      expect(await importVia(intoA.app, intoA.page, zipB)).toBe("merged");
      await expectNotice(intoA.page, 1, 1, 0);
      await expect(taskCard(intoA.page, "B edit")).toBeVisible();
      await expect(taskCard(intoA.page, "Only in B")).toBeVisible();
      expect(readTask(a, SHARED)?.alert_period_override_min).toBeNull(); // the winner's empty override clears A's
      expect(readTask(a, localOnly.id)?.title_md).toBe("Only in A");
    } finally {
      await intoA.app.close();
    }

    const intoB = await launchVesta({ dataDir: b });
    try {
      await importVia(intoB.app, intoB.page, zipA);
      await expectNotice(intoB.page, 1, 0, 1);
      await expect(taskCard(intoB.page, "B edit")).toBeVisible();
    } finally {
      await intoB.app.close();
    }
  });

  test("the same file twice changes nothing: 0 added, 0 updated (US3-8, SC-004)", async () => {
    const source = freshDataDir();
    addTasks(source, [task({ titleMd: "One" }), task({ titleMd: "Two" })]);
    seedReminders(source, [reminder({ textMd: "R" })]);
    const zip = await exportOf(source);
    const target = freshDataDir();
    addTasks(target, [task({ titleMd: "Mine" })]);
    const { app, page } = await launchVesta({ dataDir: target });
    try {
      await importVia(app, page, zip);
      await expectNotice(page, 3, 0, 0);
      await page.getByTestId("notification").getByRole("button", { name: "Close" }).click();
      const after = snapshotOf(target);
      await importVia(app, page, zip);
      await expectNotice(page, 0, 0, 3);
      expect(snapshotDiff(after, snapshotOf(target))).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("marking done on one side wins as an edit (US3-5)", async () => {
    const a = freshDataDir();
    const b = freshDataDir();
    addTasks(a, [shared({ titleMd: "Shared", doneAt: T0 + 30_000, updatedAt: T0 + 30_000 })]);
    addTasks(b, [shared({ titleMd: "Renamed in B", updatedAt: T0 + 20_000 })]);
    const zipA = await exportOf(a);
    const { app, page } = await launchVesta({ dataDir: b });
    try {
      await importVia(app, page, zipA);
      await expect(taskCard(page, "Renamed in B")).toHaveCount(0);
      expect(readTask(b, SHARED)?.done_at).toBe(T0 + 30_000);
    } finally {
      await app.close();
    }
  });

  test("settings are taken one by one, the newer of each (US3-6)", async () => {
    const a = freshDataDir();
    const b = freshDataDir();
    addTasks(a, []);
    addTasks(b, []);
    const at = (dir: string, key: string, value: unknown, time: number) => {
      seedSettings(dir, { [key]: JSON.stringify(value) });
      const db = new Database(join(dir, "data.sqlite"));
      db.prepare("update settings set updated_at = ? where key = ?").run(time, key);
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    };
    at(a, "theme", "light", 100);
    at(a, "alertPeriodMin", 180, 300);
    at(b, "theme", "dark", 200);
    at(b, "alertPeriodMin", 240, 250);
    const zipB = await exportOf(b);
    const { app, page } = await launchVesta({ dataDir: a });
    try {
      await importVia(app, page, zipB);
      expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("dark");
      const settings = snapshotOf(a).settings;
      expect(settings.find((s) => s.key === "theme")).toEqual({ key: "theme", value: "dark", updatedAt: 200 });
      expect(settings.find((s) => s.key === "alertPeriodMin")).toEqual({ key: "alertPeriodMin", value: 180, updatedAt: 300 });
    } finally {
      await app.close();
    }
  });

  test("195 active reminders + 10 imported = 205, and the empty card says the maximum is reached (US3-11, FR-038)", async () => {
    const source = freshDataDir();
    addTasks(source, []);
    seedReminders(source, Array.from({ length: 10 }, (_, i) => reminder({ textMd: `Imported ${String(i)}` })));
    const zip = await exportOf(source);
    const target = freshDataDir();
    addTasks(target, []);
    seedReminders(target, Array.from({ length: 195 }, (_, i) => reminder({ textMd: `Mine ${String(i)}` })));
    const { app, page } = await launchVesta({ dataDir: target });
    try {
      await importVia(app, page, zip);
      await expectNotice(page, 10, 0, 0);
      expect(snapshotOf(target).reminders.filter((r) => r.doneAt === null && r.deletedAt === null)).toHaveLength(205);
      await expect(page.getByText("Maximum reminders reached")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("a remap this OS refuses is dropped and logged; elsewhere it is kept (FR-033, quickstart 15)", async () => {
    const source = freshDataDir();
    addTasks(source, []);
    seedSetting(source, "shortcuts", { newTask: ["Mod+M"] });
    // The stored row is exported as it is, whatever this OS makes of it (export reads rows, not the live map).
    const zip = await exportOf(source);
    const target = freshDataDir();
    addTasks(target, []);
    const { app, page, dataDir } = await launchVesta({ dataDir: target });
    try {
      await importVia(app, page, zip);
      const stored = snapshotOf(dataDir).settings.find((s) => s.key === "shortcuts");
      const log = readdirSync(join(dataDir, "logs")).map((f) => readFileSync(join(dataDir, "logs", f), "utf8")).join("");
      if (IS_MAC) {
        expect(stored?.value).toEqual({});
        expect(log).toContain("import.shortcuts-dropped");
      } else {
        expect(stored?.value).toEqual({ newTask: ["Mod+M"] });
      }
    } finally {
      await app.close();
    }
  });

  test("imported Trash past 30 days shows until the next purge; the merged task shows; the undo notice is replaced (FR-039, FR-040)", async () => {
    // Written directly: an exporting profile would have purged an item deleted 31 days ago at its own start.
    const old = task({ titleMd: "Deleted long ago", deletedAt: Date.now() - 31 * DAY });
    const zip = join(exportFolder(), "crafted.zip");
    await writeZip(zip, {
      "data.json": toExportJson({
        appVersion: "0.8.0",
        exportedAt: Date.now(),
        tasks: [old, shared({ titleMd: "Merged title", updatedAt: T0 + 50_000 })],
        reminders: [],
        settings: [],
        assets: [],
      }),
    });
    const target = freshDataDir();
    addTasks(target, [shared({ titleMd: "Local title", updatedAt: T0 + 1 }), task({ titleMd: "Finish me" })]);
    const launched = await launchVesta({ dataDir: target });
    const { app, page } = launched;
    try {
      // An open details panel always closes once Settings is used (a click outside it, 005 FR-004); its
      // FR-040 case is covered by planReplace (tests/unit/renderer/replace-data.test.ts).
      await taskCard(page, "Finish me").getByRole("checkbox").click();
      await expect(notice(page)).toHaveAttribute("data-kind", "done");
      await importVia(app, page, zip);
      await expect(notice(page)).toHaveAttribute("data-kind", "importUndo");
      await expect(taskCard(page, "Merged title")).toBeVisible();
      await page.getByRole("button", { name: "Trash" }).click();
      await expect(page.getByText("Deleted long ago")).toBeVisible();
    } finally {
      await app.close();
    }
    // The purge at the next start (it runs at launch and hourly) removes it.
    const again = await relaunch({ ...launched, app });
    try {
      expect(readTask(target, old.id)).toBeUndefined();
    } finally {
      await again.app.close();
    }
  });
});

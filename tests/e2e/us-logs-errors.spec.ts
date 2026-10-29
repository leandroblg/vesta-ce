// 009 SC-002 (research §14): every error path 001–009 handle writes exactly one Fatal, Error or Warn entry,
// with an event name and a message. Each fault is triggered the way its own feature's spec does it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeDamaged } from "../unit/fixtures/damage";
import { taskCard } from "./fixtures/alerts";
import { exportFolder, exportVia, importVia, notice, setFault } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { readLogEntries, type Entry } from "./fixtures/logs";
import { addTasks, seedTasks, task, writeLatestJson } from "./fixtures/seed";
import { advanceClock } from "./fixtures/clock";
import { updateRequests, useReleases } from "./fixtures/releases";
import { openSettings } from "./fixtures/settings";

const PROBLEM = new Set(["fatal", "error", "warn"]);
const problems = (dataDir: string): Entry[] => readLogEntries(dataDir).filter((e) => PROBLEM.has(e.level));

/** Exactly one new problem entry since `before`, with this event and a non-empty message. */
async function expectOneProblem(dataDir: string, before: number, event: string): Promise<void> {
  await expect.poll(() => problems(dataDir).length, { timeout: 10_000 }).toBeGreaterThan(before);
  // Give a duplicate the chance to show up before counting.
  await new Promise((r) => setTimeout(r, 500));
  const fresh = problems(dataDir).slice(before);
  expect(fresh.map((e) => e.event)).toEqual([event]);
  expect(typeof fresh[0]?.["message"]).toBe("string");
  expect((fresh[0]?.["message"] as string).length).toBeGreaterThan(0);
}

async function launchedWithTask(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const dataDir = freshDataDir();
  addTasks(dataDir, [task({ titleMd: "Mine" })]);
  const launched = await launchVesta({ dataDir, env });
  await expect(taskCard(launched.page, "Mine")).toBeVisible();
  return launched;
}

function validZip(): string {
  const zip = join(exportFolder(), "valid.zip");
  writeDamaged(zip, "valid");
  return zip;
}

test.describe("009 SC-002 — one log entry per failure", () => {
  test("save: a failed write (VESTA_FAULT=save) → save.failed", async () => {
    const { app, page, dataDir } = await launchedWithTask();
    try {
      const before = problems(dataDir).length;
      await setFault(app, "save");
      await taskCard(page, "Mine").getByRole("checkbox").click();
      await expectOneProblem(dataDir, before, "save.failed");
    } finally {
      await app.close();
    }
  });

  test("asset-write: a file that cannot be stored → save.failed", async () => {
    const { app, page, dataDir } = await launchedWithTask();
    try {
      const before = problems(dataDir).length;
      await setFault(app, "asset-write");
      await page.evaluate(() => window.vesta.assets.importBytes({ name: "a.png", bytes: new Uint8Array([137, 80, 78, 71]), scope: "details" }));
      await expectOneProblem(dataDir, before, "save.failed");
    } finally {
      await app.close();
    }
  });

  for (const [fault, event] of [
    ["purge", "purge.failed"],
    ["asset-unlink", "purge.failed"],
  ] as const) {
    test(`${fault}: the purge at start fails → ${event}`, async () => {
      const dataDir = freshDataDir();
      seedTasks(dataDir, [task({ titleMd: "Mine" })]);
      const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: fault } });
      try {
        await expect(taskCard(page, "Mine")).toBeVisible();
        await expectOneProblem(dataDir, 0, event);
      } finally {
        await app.close();
      }
    });
  }

  for (const [fault, event] of [
    ["backup", "backup.failed"],
    ["damaged", "backup.data-damaged"],
  ] as const) {
    test(`${fault}: the automatic backup at start fails → ${event}`, async () => {
      const dataDir = freshDataDir();
      seedTasks(dataDir, [task({ titleMd: "Mine" })]);
      writeLatestJson(dataDir, Date.now() - 31 * 60_000);
      const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: fault } });
      try {
        await expect(page.getByTestId("notification")).toBeVisible();
        await expectOneProblem(dataDir, 0, event);
      } finally {
        await app.close();
      }
    });
  }

  test("export-write: an export that cannot be written → export.failed", async () => {
    const { app, page, dataDir } = await launchedWithTask();
    try {
      const before = problems(dataDir).length;
      await setFault(app, "export-write");
      await exportVia(app, page, exportFolder());
      await expectOneProblem(dataDir, before, "export.failed");
    } finally {
      await app.close();
    }
  });

  for (const [fault, event] of [
    ["pre-import-backup", "import.not-started"],
    ["import-write", "import.failed"],
  ] as const) {
    test(`${fault}: an import that cannot complete → ${event}`, async () => {
      const { app, page, dataDir } = await launchedWithTask();
      try {
        await expect.poll(() => existsSync(join(dataDir, "backups", "latest.json"))).toBe(true);
        const before = problems(dataDir).length;
        await setFault(app, fault);
        expect(await importVia(app, page, validZip())).toBe("kept");
        await expectOneProblem(dataDir, before, event);
      } finally {
        await app.close();
      }
    });
  }

  test("undo-restore: an Undo import that fails → import.undo-failed", async () => {
    const { app, page, dataDir } = await launchedWithTask();
    try {
      await expect.poll(() => existsSync(join(dataDir, "backups", "latest.json"))).toBe(true);
      expect(await importVia(app, page, validZip())).toBe("merged");
      const before = problems(dataDir).length;
      await setFault(app, "undo-restore");
      await page.getByTestId("undo-import").click();
      await expect(notice(page)).toContainText("The import could not be undone.");
      await expectOneProblem(dataDir, before, "import.undo-failed");
    } finally {
      await app.close();
    }
  });

  test("an error in the window → renderer.error", async () => {
    const { app, page, dataDir } = await launchedWithTask();
    try {
      const before = problems(dataDir).length;
      await page.evaluate(() => window.vesta.app.logError({ message: "boom in the window", stack: "Error: boom\n  at x", context: "test" }));
      await expectOneProblem(dataDir, before, "renderer.error");
    } finally {
      await app.close();
    }
  });
});

test.describe("009 SC-002, SC-007 — a failed update check", () => {
  test("a manual check that fails offline → one update.check.failed Warn, no dialog (T068)", async () => {
    const { app, page, dataDir } = await launchedWithTask();
    try {
      await expect.poll(async () => (await updateRequests(app)).length).toBeGreaterThanOrEqual(1);
      const before = problems(dataDir).length;
      await useReleases(app, { fail: "offline" });
      await advanceClock(app, 61_000);
      await openSettings(page, "Updates");
      await page.getByTestId("update-check").click();
      await expect(page.getByTestId("update-status")).toHaveText("Vesta could not check for updates. Check your connection and try again.");
      await new Promise((r) => setTimeout(r, 500));
      const fresh = problems(dataDir).slice(before);
      expect(fresh.map((e) => [e.level, e.event, e["reason"]])).toEqual([["warn", "update.check.failed", "offline"]]);
      await expect(page.getByTestId("notification")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

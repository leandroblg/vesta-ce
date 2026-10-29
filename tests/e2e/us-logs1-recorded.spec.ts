// 009 US1 — every problem is recorded, within a fixed size (US1-1 to US1-5; quickstart 1, 12).
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { allLogText, entriesFor, logDir, readLogEntries, seedLogs } from "./fixtures/logs";
import { seedSetting, seedTasks, task } from "./fixtures/seed";

const MiB = 1_048_576;
const toast = (page: Page) => page.getByTestId("notification");
const card = (page: Page, title: string) => page.locator("li[data-kind='task']").filter({ hasText: title });

async function addTask(page: Page, title: string) {
  const editor = page.getByRole("textbox", { name: "New task…" });
  if (!(await editor.isVisible())) await page.getByRole("button", { name: "New task…" }).click();
  await editor.fill(title);
  await editor.press("Enter");
}

function logFolderBytes(dataDir: string): { files: number; total: number; largest: number } {
  const names = readdirSync(logDir(dataDir)).filter((n) => /^vesta-\d{3}\.log$/.test(n));
  const sizes = names.map((n) => statSync(join(logDir(dataDir), n)).size);
  return { files: names.length, total: sizes.reduce((a, b) => a + b, 0), largest: Math.max(0, ...sizes) };
}

test.describe("009 US1 — every problem is recorded, within a fixed size", () => {
  test("a failed save writes one save.failed Error entry with time, action and message (US1-1)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Fix bike" })]);
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "save" } });
    try {
      await card(page, "Fix bike").getByRole("checkbox").click();
      await expect(toast(page)).toHaveAttribute("data-kind", "saveFailed");
      await expect.poll(() => entriesFor(dataDir, "save.failed").length).toBe(1);
      const [entry] = entriesFor(dataDir, "save.failed");
      expect(entry).toMatchObject({ level: "error", action: "tasks:mark-done", message: "VESTA_FAULT=save" });
      expect(Number.isNaN(Date.parse(entry?.time ?? ""))).toBe(false);
    } finally {
      await app.close();
    }
  });

  test("the data folder is logged with the home folder written as ~ (FR-003)", async () => {
    const home = mkdtempSync(join(tmpdir(), "vesta-home-"));
    const dataDir = join(home, "Vesta");
    mkdirSync(dataDir, { recursive: true });
    const { app } = await launchVesta({ dataDir, env: { HOME: home } });
    try {
      await expect.poll(() => entriesFor(dataDir, "app.started").length).toBe(1);
      expect(entriesFor(dataDir, "app.started")[0]?.["dataDir"]).toBe("~/Vesta");
      expect(allLogText(dataDir)).not.toContain(home);
    } finally {
      await app.close();
    }
  });

  test("a full 50 MiB log folder stays within its limits while Vesta keeps logging (US1-2, US1-3)", async () => {
    const dataDir = freshDataDir();
    // 50 files of about 1 MiB each: the next file needs the oldest one gone.
    seedLogs(dataDir, { numbers: Array.from({ length: 50 }, (_, i) => i + 1), perFile: 100, entryBytes: 10_400 });
    expect(logFolderBytes(dataDir).total).toBeGreaterThan(49 * MiB);
    seedSetting(dataDir, "logLevel", "trace");
    const { app, page } = await launchVesta({ dataDir });
    try {
      for (let i = 0; i < 30; i++) await addTask(page, `Task ${String(i)}`);
      await expect(page.locator("li[data-kind='task']")).toHaveCount(30);
      const after = logFolderBytes(dataDir);
      expect(after.files).toBeLessThanOrEqual(50);
      expect(after.largest).toBeLessThanOrEqual(MiB);
      expect(after.total).toBeLessThanOrEqual(50 * MiB);
      expect(readdirSync(logDir(dataDir))).not.toContain("vesta-001.log");
    } finally {
      await app.close();
    }
  });

  test("an unwritable log folder leaves Vesta working, with no crash notice (US1-4, FR-008)", async () => {
    test.skip(process.getuid?.() === 0, "root ignores folder permissions");
    const dataDir = freshDataDir();
    mkdirSync(logDir(dataDir), { recursive: true });
    chmodSync(logDir(dataDir), 0o500);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await addTask(page, "Still works");
      await expect(card(page, "Still works")).toBeVisible();
      await expect(toast(page)).toHaveCount(0);
    } finally {
      await app.close();
      chmodSync(logDir(dataDir), 0o755);
    }
  });

  test("item text never reaches the logs, even at Trace (US1-5, FR-003)", async () => {
    const dataDir = freshDataDir();
    seedSetting(dataDir, "logLevel", "trace");
    const { app, page } = await launchVesta({ dataDir });
    try {
      await addTask(page, "Pay the SECRET-4711 invoice");
      await expect(card(page, "SECRET-4711")).toBeVisible();
      await expect.poll(() => entriesFor(dataDir, "ipc.call").some((e) => e["channel"] === "tasks:create")).toBe(true);
      expect(allLogText(dataDir)).not.toContain("SECRET-4711");
    } finally {
      await app.close();
    }
  });

  test("entries stay in English whatever the language (FR-004)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Arrumar a bicicleta" })]);
    seedSetting(dataDir, "language", "pt-BR");
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "save" } });
    try {
      await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
      await card(page, "Arrumar a bicicleta").getByRole("checkbox").click();
      await expect.poll(() => entriesFor(dataDir, "save.failed").length).toBe(1);
      expect(entriesFor(dataDir, "save.failed")[0]?.["message"]).toBe("VESTA_FAULT=save");
      expect(readLogEntries(dataDir).every((e) => /^[a-z][a-z0-9.-]*$/.test(e.event))).toBe(true);
    } finally {
      await app.close();
    }
  });
});

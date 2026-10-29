import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { corrupt, seedTasks, task, writeBackup, writeLatestJson } from "./fixtures/seed";
import { readFileSync } from "node:fs";
import { clickRevealed } from "./fixtures/hover";

const titles = (page: Page) => page.locator("li[data-kind='task'] .title");
const toast = (page: Page) => page.getByTestId("notification");

test.describe("US6 — data stays safe when something goes wrong", () => {
  test("a launch 30+ minutes after the last backup writes a new one (1)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Keep me" })]);
    writeLatestJson(dataDir, Date.now() - 31 * 60_000);
    const { app } = await launchVesta({ dataDir });
    try {
      await expect.poll(() => existsSync(join(dataDir, "backups", "latest.sqlite")), { timeout: 10_000 }).toBe(true);
    } finally {
      await app.close();
    }
  });

  for (const mode of ["random", "truncate", "badPage"] as const) {
    test(`corrupt data (${mode}) with a valid backup: restored, time shown, leftovers set aside (2, SC-008)`, async () => {
      const dataDir = freshDataDir();
      mkdirSync(dataDir, { recursive: true });
      writeBackup(dataDir, [task({ titleMd: "From backup" })], Date.UTC(2026, 9, 1, 9, 30));
      seedTasks(dataDir, [task({ titleMd: "Lost change" })]);
      writeFileSync(join(dataDir, "data.sqlite-wal"), "leftover");
      corrupt(join(dataDir, "data.sqlite"), mode);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await expect(titles(page)).toHaveText(["From backup"]);
        await expect(toast(page)).toHaveAttribute("role", "alert");
        await expect(toast(page)).toContainText("Data was restored from the backup of Oct 1, 2026");
        await expect(toast(page)).toContainText("files no longer used were moved to");
        const recovered = readdirSync(dataDir).filter((f) => f.startsWith("recovered-"));
        expect(recovered).toHaveLength(1);
        await page.waitForTimeout(10_500);
        await expect(toast(page)).toBeVisible(); // sticky until closed
      } finally {
        await app.close();
      }
    });
  }

  test("corrupt data with an invalid backup: empty list and a sticky 'could not be recovered' (3)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Gone" })]);
    corrupt(join(dataDir, "data.sqlite"), "random");
    mkdirSync(join(dataDir, "backups"), { recursive: true });
    writeFileSync(join(dataDir, "backups", "latest.sqlite"), "not a database");
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(titles(page)).toHaveCount(0);
      await expect(toast(page)).toContainText("Your data could not be recovered. The damaged file was kept at");
      expect(readdirSync(join(dataDir, "damaged")).filter((f) => f.endsWith(".sqlite"))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  test("corrupt data with no backup: a first run with no notice; the damaged copy is kept (4)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Gone" })]);
    corrupt(join(dataDir, "data.sqlite"), "truncate");
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(page.getByRole("button", { name: "New task…" })).toBeVisible();
      await expect(toast(page)).toHaveCount(0);
      // One damaged copy (its -wal/-shm working files travel with it).
      expect(readdirSync(join(dataDir, "damaged")).filter((f) => f.endsWith(".sqlite"))).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  test("a failed save keeps the list at the last saved state with a sticky notice (5, FR-040)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Still here" })]);
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "save" } });
    try {
      await page.locator("li[data-kind='task']").getByRole("checkbox").click();
      await expect(toast(page)).toContainText("Changes are not saved");
      await expect(titles(page)).toHaveText(["Still here"]);
      await page.waitForTimeout(10_500);
      await expect(toast(page)).toContainText("Changes are not saved");
      await clickRevealed(toast(page), toast(page).getByRole("button", { name: "Close" }));
      await expect(toast(page)).toHaveCount(0);
      const log = join(dataDir, "logs", "vesta-001.log");
      await expect.poll(() => existsSync(log) && statSync(log).size > 0).toBe(true);
    } finally {
      await app.close();
    }
  });

  test("works offline with zero network requests (6, SC-010)", async () => {
    const { app, page } = await launchVesta();
    const requests: string[] = [];
    page.on("request", (r) => {
      // 010 L13: the page and its stored files load from Vesta's own schemes, which are not network requests.
      if (!/^(?:file|app|vesta-asset):/.test(r.url())) requests.push(r.url());
    });
    try {
      await page.reload();
      await page.locator("main[aria-busy='false']").waitFor();
      await page.getByRole("button", { name: "New task…" }).click();
      await page.getByRole("textbox", { name: "New task…" }).fill("Offline");
      await page.getByRole("textbox", { name: "New task…" }).press("Enter");
      await expect(titles(page)).toHaveText(["Offline"]);
      expect(requests).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("a missing data folder is created; an unwritable one shows a sticky notice (7)", async () => {
    test.skip(process.platform === "win32", "chmod does not make a folder read-only on Windows");
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Readable" })]);
    chmodSync(dataDir, 0o555);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(titles(page)).toHaveText(["Readable"]);
      await expect(toast(page)).toContainText("Vesta cannot save to its data folder");
      await clickRevealed(toast(page), toast(page).getByRole("button", { name: "Close" }));
      await page.locator("li[data-kind='task']").getByRole("checkbox").click();
      await expect(toast(page)).toContainText("Changes are not saved");
      await expect(titles(page)).toHaveText(["Readable"]);
    } finally {
      await app.close();
      chmodSync(dataDir, 0o755);
    }
  });

  test("corruption found while running: sticky notice, no backup written; the next launch restores (9, FR-041b)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Current" })]);
    writeBackup(dataDir, [task({ titleMd: "From backup" })], Date.now() - 31 * 60_000); // due at launch
    const latestJson = () => readFileSync(join(dataDir, "backups", "latest.json"), "utf8");
    const before = latestJson();
    const run = await launchVesta({ dataDir, env: { VESTA_FAULT: "damaged" } });
    try {
      await expect(toast(run.page)).toContainText("Your data may be damaged. Restart Vesta to restore the latest backup.");
      await expect(toast(run.page)).toHaveAttribute("role", "alert");
      expect(latestJson()).toBe(before); // the damaged data never replaces the last good backup
    } finally {
      await run.app.close();
    }
    corrupt(join(dataDir, "data.sqlite"), "random");
    const next = await launchVesta({ dataDir });
    try {
      await expect(titles(next.page)).toHaveText(["From backup"]);
      await expect(toast(next.page)).toContainText("Data was restored from the backup of");
    } finally {
      await next.app.close();
    }
  });

  test("a failed backup keeps the last one and shows a 10 s notice (8, FR-041a)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Data" })]);
    writeLatestJson(dataDir, Date.now() - 31 * 60_000);
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "backup" } });
    try {
      await expect(toast(page)).toContainText("Automatic backup failed. The last backup, from");
      await expect(toast(page)).toHaveAttribute("role", "status");
      await expect(toast(page)).toHaveCount(0, { timeout: 12_000 });
      expect(existsSync(join(dataDir, "backups", "latest.sqlite"))).toBe(false);
    } finally {
      await app.close();
    }
  });
});

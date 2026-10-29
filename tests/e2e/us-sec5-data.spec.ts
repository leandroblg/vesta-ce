// 010 US5 (L9, M3, L15; FR-008, FR-023, FR-024): my data folder is mine alone and deleted content is gone.
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { toExportJson } from "../../src/domain/export/format";
import { writeZip } from "../unit/fixtures/zip";
import { taskCard } from "./fixtures/alerts";
import { DAY } from "./fixtures/clock";
import { exportFolder, importVia } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const unix = process.platform !== "win32";
const root = typeof process.getuid === "function" && process.getuid() === 0;

const tempDirsOf = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __vestaTest: { tempDirs: () => string[] } }).__vestaTest.tempDirs());
const userDataOf = (app: ElectronApplication) => app.evaluate(({ app: a }) => ({ userData: a.getPath("userData"), temp: a.getPath("temp") }));

test.describe("010 US5 — my data folder is mine alone and deleted content is gone", () => {
  test.skip(!unix, "file modes and read-only folders are Unix-only");

  test("L9 a fresh data folder, its database and every stored file are owner-only", async () => {
    const dataDir = freshDataDir();
    const { app, page } = await launchVesta({ dataDir });
    try {
      expect(statSync(dataDir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dataDir, "data.sqlite")).mode & 0o777).toBe(0o600);
      for (const suffix of ["-wal", "-shm"]) {
        const path = join(dataDir, `data.sqlite${suffix}`);
        if (existsSync(path)) expect(statSync(path).mode & 0o777, suffix).toBe(0o600);
      }
      expect(statSync(join(dataDir, "logs", "vesta-001.log")).mode & 0o777).toBe(0o600);
      // A file that enters the data folder through an import is owner-only too (FR-023, SC-007; convergence T088).
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);
      const sha = createHash("sha256").update(png).digest("hex");
      const zip = join(exportFolder(), "owner-only.zip");
      await writeZip(zip, {
        "data.json": toExportJson({
          appVersion: "0.9.0",
          exportedAt: Date.now(),
          tasks: [task({ titleMd: "With image", detailsMd: `![i](assets/${sha}.png)` })],
          reminders: [],
          settings: [],
          assets: [{ sha256: sha, ext: "png", mimeType: "image/png", size: png.length }],
        }),
        [`assets/${sha}.png`]: png,
      });
      expect(await importVia(app, page, zip)).toBe("merged");
      expect(statSync(join(dataDir, "assets", `${sha}.png`)).mode & 0o777).toBe(0o600);
    } finally {
      await app.close();
    }
  });

  test("M3 a read-only data folder gives a random, owner-only profile that is removed at quit", async () => {
    test.skip(root, "root can write anywhere");
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Read me" })]);
    chmodSync(dataDir, 0o500);
    const names: string[] = [];
    const leftovers: string[] = [];
    try {
      for (let i = 0; i < 2; i += 1) {
        const { app, page } = await launchVesta({ dataDir });
        try {
          await expect(taskCard(page, "Read me")).toBeVisible();
          const { userData, temp } = await userDataOf(app);
          expect(userData.startsWith(join(temp, "vesta-profile-"))).toBe(true);
          names.push(userData);
          const dirs = await tempDirsOf(app);
          expect(dirs).toHaveLength(2);
          expect(dirs.some((d) => d.startsWith(join(temp, "vesta-readonly-")))).toBe(true);
          for (const d of dirs) expect(existsSync(d), d).toBe(true);
          await app.close();
          // The read-only copy (user data) goes at quit; Chromium writes its profile shell after the last code runs,
          // so that folder is swept at the next start (research §15).
          const copy = dirs.find((d) => d.startsWith(join(temp, "vesta-readonly-")));
          if (copy === undefined) throw new Error("no read-only copy registered");
          await expect.poll(() => existsSync(copy), { timeout: 10_000 }).toBe(false);
          leftovers.push(userData);
        } catch (err) {
          await app.close().catch(() => undefined);
          throw err;
        }
      }
      expect(names[0]).not.toBe(names[1]);
      // The second launch swept the first run's profile folder; a third launch sweeps the second's.
      expect(existsSync(leftovers[0] ?? "")).toBe(false);
      const third = await launchVesta({ dataDir });
      await third.app.close();
      for (const d of leftovers) expect(existsSync(d), d).toBe(false);
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  test("L15 a permanently deleted item leaves no trace in the database files", async () => {
    const dataDir = freshDataDir();
    const marker = randomBytes(16).toString("hex");
    const now = Date.now();
    seedTasks(dataDir, [task({ titleMd: "Keep me" }), task({ titleMd: `Secret ${marker}`, deletedAt: now - 31 * DAY })]);
    const files = () => ["", "-wal", "-shm"].map((s) => join(dataDir, `data.sqlite${s}`)).filter((p) => existsSync(p));
    expect(files().some((p) => readFileSync(p).includes(marker))).toBe(true);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(taskCard(page, "Keep me")).toBeVisible();
      // The launch purge removed the 31-day-old Trash item and ran the maintenance step.
      await expect.poll(() => files().filter((p) => readFileSync(p).includes(marker)).length, { timeout: 15_000 }).toBe(0);
    } finally {
      await app.close();
    }
    expect(files().filter((p) => readFileSync(p).includes(marker))).toEqual([]);
  });
});

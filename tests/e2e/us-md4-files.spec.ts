// 005 US4: files, images and videos (quickstart scenarios 10–13a, tasks T050, T058).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, readTask } from "./fixtures/clock";
import { caretAtEnd, dropFile, dropLargeFile, menu, pasteText, selectText } from "./fixtures/editor";
import { nextConfirm } from "./fixtures/files";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { expectOnly, goOffline, recordRequests } from "./fixtures/network";
import { seedAsset, seedTasks, task, writeLatestJson } from "./fixtures/seed";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC",
  "base64",
);
const YT = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** The ref seedAsset will give these bytes, known before the database exists. */
const refOf = (bytes: Buffer, ext: string) => `assets/${createHash("sha256").update(bytes).digest("hex")}.${ext}`;

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });

function files(): string {
  const dir = mkdtempSync(join(tmpdir(), "vesta-files-"));
  writeFileSync(join(dir, "screenshot.png"), PNG);
  writeFileSync(join(dir, "contract.pdf"), "%PDF-1.4\n%%EOF\n");
  writeFileSync(join(dir, "install.sh"), "#!/bin/sh\necho hi\n");
  return dir;
}

function assetRows(dataDir: string): { sha256: string; ext: string; removed_at: number | null }[] {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    return db.prepare("select sha256, ext, removed_at from assets order by ext").all() as {
      sha256: string;
      ext: string;
      removed_at: number | null;
    }[];
  } finally {
    db.close();
  }
}

/** Replaces the app's shell calls with recorders (FR-031 opening). */
async function stubShell(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { shellCalls: string[] };
    g.shellCalls = [];
    shell.openPath = (p: string) => {
      g.shellCalls.push(`openPath ${p}`);
      return Promise.resolve("");
    };
    shell.showItemInFolder = (p: string) => {
      g.shellCalls.push(`show ${p}`);
    };
    shell.openExternal = (u: string) => {
      g.shellCalls.push(`external ${u}`);
      return Promise.resolve();
    };
  });
}
const shellCalls = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { shellCalls: string[] }).shellCalls);

async function openDetails(page: Page, title: string) {
  await taskCard(page, title).locator(".title").click();
  await expect(details(page)).toBeVisible();
  await caretAtEnd(details(page));
}

test.describe("005 US4 — files, images and videos", () => {
  test("dropped image and PDF are stored, survive deleting the originals and a restart, and open (10)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Files" });
    seedTasks(dataDir, [a]);
    const src = files();
    let run = await launchVesta({ dataDir });
    try {
      await openDetails(run.page, "Files");
      await dropFile(details(run.page), join(src, "screenshot.png"), "image/png");
      await expect(details(run.page).locator("img:not(.ProseMirror-separator)")).toHaveCount(1);
      await dropFile(details(run.page), join(src, "contract.pdf"), "application/pdf");
      await expect(details(run.page).locator("a", { hasText: "contract.pdf" })).toBeVisible();
      await dropFile(details(run.page), join(src, "install.sh"));
      await expect(details(run.page).locator("a", { hasText: "install.sh" })).toBeVisible();
      await expect(panel(run.page).locator(".saved")).toHaveText("Saved");
      rmSync(src, { recursive: true, force: true });

      run = await relaunch(run);
      await stubShell(run.app);
      await openDetails(run.page, "Files");
      const img = details(run.page).locator("img:not(.ProseMirror-separator)");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(4);
      const md = readTask(dataDir, a.id)?.details_md ?? "";
      expect(md).toMatch(/!\[screenshot\.png\]\(assets\/[0-9a-f]{64}\.png\)/);
      expect(md).toMatch(/\[contract\.pdf\]\(assets\/[0-9a-f]{64}\.pdf\)/);
      // In the editor, Cmd/Ctrl+click opens; the PDF with the default app, the script in its folder.
      const pdf = details(run.page).locator("a", { hasText: "contract.pdf" });
      await expect(pdf).toHaveAttribute("title", /^(Cmd|Ctrl)\+click to open$/);
      await pdf.click();
      expect(await shellCalls(run.app)).toEqual([]);
      await pdf.click({ modifiers: ["ControlOrMeta"] });
      await details(run.page)
        .locator("a", { hasText: "install.sh" })
        .click({ modifiers: ["ControlOrMeta"] });
      await expect
        .poll(() => shellCalls(run.app))
        .toEqual([
          expect.stringMatching(/^openPath .*assets\/[0-9a-f]{64}\.pdf$/),
          expect.stringMatching(/^show .*assets\/[0-9a-f]{64}\.sh$/),
        ]);
    } finally {
      await run.app.close();
    }
  });

  test("refusals: over 100 MB, a PDF in a title; the same image twice is stored once (11)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Refuse" })]);
    const src = files();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openDetails(page, "Refuse");
      await dropLargeFile(details(page), "trip.mov", 101 * 1024 * 1024, "video/quicktime");
      await expect(page.getByRole("alert")).toHaveText("“trip.mov” is larger than 100 MB and was not added.");
      expect(assetRows(dataDir)).toEqual([]);
      await dropFile(details(page), join(src, "screenshot.png"), "image/png");
      await dropFile(details(page), join(src, "screenshot.png"), "image/png");
      await expect(details(page).locator("img:not(.ProseMirror-separator)")).toHaveCount(2);
      expect(assetRows(dataDir)).toHaveLength(1);
      await page.keyboard.press("Escape");

      await taskCard(page, "Refuse").locator(".title").dblclick();
      const title = page.locator("li[data-kind='task'] .inline-edit .ProseMirror");
      await dropFile(title, join(src, "contract.pdf"), "application/pdf");
      await expect(page.getByRole("alert")).toHaveText("Only images can be added to a title.");
      expect(assetRows(dataDir)).toHaveLength(1);
    } finally {
      await app.close();
      rmSync(src, { recursive: true, force: true });
    }
  });

  test("YouTube: nocookie player online, placeholder offline, a pasted youtube.com iframe rewritten (12)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Video", detailsMd: YT })]);
    const { app, page } = await launchVesta({ dataDir });
    const requests = recordRequests(page);
    try {
      await openDetails(page, "Video");
      const frame = details(page).locator("iframe");
      await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
      await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
      expectOnly(requests, ["www.youtube-nocookie.com"]);
      await goOffline(page);
      await expect(details(page).locator("[data-yt-offline]")).toContainText("YouTube video (offline): " + YT);
      await expect(details(page).locator("iframe")).toHaveCount(0);

      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await pasteText(
        details(page),
        '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>',
      );
      await goOffline(page, false);
      await expect(details(page).locator("span[data-type='html'] iframe")).toHaveAttribute(
        "src",
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      );
    } finally {
      await app.close();
    }
  });

  test("purge: an asset whose only item is permanently deleted goes; one used from the Trash stays; a shared one stays (13)", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    const lone = refOf(Buffer.from("lone"), "txt");
    const trashed = refOf(Buffer.from("trash"), "txt");
    const shared = refOf(Buffer.from("shared"), "txt");
    const gone = task({ titleMd: "Gone", detailsMd: `[l](${lone})`, deletedAt: now - 31 * DAY });
    const inTrash = task({ titleMd: "In trash", detailsMd: `[t](${trashed})`, deletedAt: now - DAY });
    const a = task({ titleMd: "A", detailsMd: `[s](${shared})` });
    const b = task({ titleMd: "B", detailsMd: `[s](${shared})` });
    seedTasks(dataDir, [gone, inTrash, a, b]);
    for (const [body, ext] of [
      ["lone", "txt"],
      ["trash", "txt"],
      ["shared", "txt"],
    ] as const)
      seedAsset(dataDir, Buffer.from(body), ext, "text/plain");
    let run = await launchVesta({ dataDir });
    const { page } = run;
    try {
      // The launch purge ran: the lone file went, the Trash one and the shared one stayed.
      await expect.poll(() => existsSync(join(dataDir, lone))).toBe(false);
      expect(existsSync(join(dataDir, trashed))).toBe(true);
      expect(existsSync(join(dataDir, shared))).toBe(true);

      // A's copy is edited out, then A is deleted and purged: B still has the file.
      await openDetails(page, "A");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Backspace");
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      await page.keyboard.press("Escape");
      await taskCard(page, "A").hover();
      await taskCard(page, "A").getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "Move to Trash" }).click();
      await expect(taskCard(page, "A")).toHaveCount(0);
      // 31 days later, the launch purge removes A for good; B still references the shared file.
      run = await relaunch(run, { env: { VESTA_CLOCK_OFFSET_MIN: String(31 * 24 * 60 + 60) } });
      await expect.poll(() => readTask(dataDir, a.id)).toBeUndefined();
      expect(existsSync(join(dataDir, shared))).toBe(true);
      expect(assetRows(dataDir).map((r) => r.sha256)).toContain(shared.slice(7, 71));
      await openDetails(run.page, "B");
      await expect(details(run.page).locator("a", { hasText: "s" })).toBeVisible();
    } finally {
      await run.app.close();
    }
  });

  test("13a: an asset only the latest backup lists is kept, tagged, and still displays after restoring that backup", async () => {
    const dataDir = freshDataDir();
    const ref = refOf(PNG, "png");
    const imgTask = task({ titleMd: "With image", detailsMd: `![p](${ref})` });
    seedTasks(dataDir, [task({ titleMd: "Old" }), imgTask]);
    seedAsset(dataDir, PNG, "png", "image/png");
    // The latest backup is a copy of this database (its asset row included); then the live database drops
    // the task that used the image, and keeps the backup's lock.
    mkdirSync(join(dataDir, "backups"), { recursive: true });
    copyFileSync(join(dataDir, "data.sqlite"), join(dataDir, "backups", "latest.sqlite"));
    writeLatestJson(dataDir, Date.now() - 1000);
    // Only a delete: the 006 search delete triggers call no SQL function, so no registration is needed.
    const db = new Database(join(dataDir, "data.sqlite"));
    db.prepare("delete from tasks where id = ?").run(imgTask.id);
    db.prepare("insert into backup_assets (backup, path) values ('backups/latest.sqlite', ?)").run(ref);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    let run = await launchVesta({ dataDir });
    try {
      // The launch purge finds it unreferenced but locked: row and file kept, tagged.
      await expect.poll(() => assetRows(dataDir)[0]?.removed_at ?? null).not.toBeNull();
      expect(existsSync(join(dataDir, ref))).toBe(true);
      await run.app.close();
      // The data goes bad; the backup is restored at start, with its image.
      writeFileSync(join(dataDir, "data.sqlite"), "damaged");
      for (const s of ["-wal", "-shm"])
        if (existsSync(join(dataDir, `data.sqlite${s}`))) rmSync(join(dataDir, `data.sqlite${s}`));
      run = await launchVesta({ dataDir });
      await openDetails(run.page, "With image");
      const img = details(run.page).locator("img:not(.ProseMirror-separator)");
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(4);
    } finally {
      await run.app.close();
    }
  });

  test("a stored file deleted by hand shows its name as missing; the problem is logged (FR-033)", async () => {
    const dataDir = freshDataDir();
    const ref = refOf(PNG, "png");
    seedTasks(dataDir, [task({ titleMd: `Pic ![photo.png](${ref})`, detailsMd: `![photo.png](${ref})` })]);
    seedAsset(dataDir, PNG, "png", "image/png");
    rmSync(join(dataDir, ref));
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(page.locator("li[data-kind='task'] [data-md-placeholder='file-missing']")).toHaveText(
        "“photo.png” is missing.",
      );
      await page.locator("li[data-kind='task'] .title").first().click();
      await expect(details(page)).toBeVisible();
      await expect(details(page).locator("[data-md-placeholder='file-missing']")).toHaveText("“photo.png” is missing.");
    } finally {
      await app.close();
    }
  });

  test("a typed file: link copies the file and links to the copy; a missing path is refused (FR-027a)", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Link file", detailsMd: "the contract" });
    seedTasks(dataDir, [a]);
    const src = files();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openDetails(page, "Link file");
      await selectText(details(page), "contract");
      await menu(page).getByRole("button", { name: "Link" }).click();
      const url = menu(page).getByRole("textbox", { name: "Link", exact: true });
      await url.fill(`file://${join(src, "contract.pdf")}`);
      await nextConfirm(app, true); // 010 M1: typed paths are confirmed before the copy
      await url.press("Enter");
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      expect(readTask(dataDir, a.id)?.details_md).toMatch(/^the \[contract\]\(assets\/[0-9a-f]{64}\.pdf\)$/);
      await selectText(details(page), "the");
      await menu(page).getByRole("button", { name: "Link" }).click();
      await menu(page).getByRole("textbox", { name: "Link", exact: true }).fill(join(src, "missing.pdf"));
      await menu(page).getByRole("textbox", { name: "Link", exact: true }).press("Enter");
      await expect(page.getByRole("alert")).toHaveText("“missing.pdf” is missing.");
    } finally {
      await app.close();
      rmSync(src, { recursive: true, force: true });
    }
  });

  test("on a card a web link opens in the browser and the panel stays closed (FR-031)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Read [the docs](https://example.com/docs)" })]);
    const { app, page } = await launchVesta({ dataDir });
    await stubShell(app);
    try {
      await page.locator("li[data-kind='task'] .title a").click();
      await expect.poll(() => shellCalls(app)).toEqual(["external https://example.com/docs"]);
      await page.waitForTimeout(400);
      await expect(panel(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

// 010 US1 (M1, FR-001 to FR-003): a file named by path is copied only after the user confirms it.
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { caretAtEnd, dropFile, menu, selectText } from "./fixtures/editor";
import { confirmRequests, nextConfirm } from "./fixtures/files";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const linkBox = (page: Page) => menu(page).getByRole("textbox", { name: "Link", exact: true });
const storedFiles = (dataDir: string) => (existsSync(join(dataDir, "assets")) ? readdirSync(join(dataDir, "assets")).filter((n) => !n.startsWith(".")) : []);

function sourceFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), "vesta-sec1-"));
  writeFileSync(join(dir, "contract.pdf"), "%PDF-1.4 the contract");
  return dir;
}

async function openDetails(page: Page, title: string): Promise<void> {
  await taskCard(page, title).locator(".title").click();
  await expect(details(page)).toBeVisible();
  await caretAtEnd(details(page));
}

async function typeLinkPath(page: Page, text: string, path: string): Promise<void> {
  await selectText(details(page), text);
  await menu(page).getByRole("button", { name: "Link" }).click();
  await linkBox(page).fill(path);
  await linkBox(page).press("Enter");
}

test.describe("010 US1 — a typed path is copied only after confirmation (M1)", () => {
  test("M1 Cancel stores nothing, Add stores the copy, and the dialog names the file and its folder", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Link file", detailsMd: "the contract and the annex" });
    seedTasks(dataDir, [a]);
    const src = sourceFolder();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openDetails(page, "Link file");
      await nextConfirm(app, false);
      await typeLinkPath(page, "contract", `file://${join(src, "contract.pdf")}`);
      await expect.poll(() => confirmRequests(app)).toEqual([{ name: "contract.pdf", folder: realpathSync(src) }]);
      await page.waitForTimeout(600);
      expect(storedFiles(dataDir)).toEqual([]);
      expect(readTask(dataDir, a.id)?.details_md).toBe("the contract and the annex");

      await nextConfirm(app, true);
      await typeLinkPath(page, "annex", join(src, "contract.pdf"));
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      expect(readTask(dataDir, a.id)?.details_md).toMatch(/\[annex\]\(assets\/[0-9a-f]{64}\.pdf\)/);
      expect(storedFiles(dataDir)).toHaveLength(1);
      expect(await confirmRequests(app)).toHaveLength(2);
    } finally {
      await app.close();
      rmSync(src, { recursive: true, force: true });
    }
  });

  test("M1 a path inside the data folder is refused with a message and no dialog", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Link file", detailsMd: "the contract" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openDetails(page, "Link file");
      await typeLinkPath(page, "contract", join(dataDir, "data.sqlite"));
      await expect(page.getByRole("alert")).toHaveText("“data.sqlite” is inside Vesta's data folder and cannot be added.");
      expect(await confirmRequests(app)).toEqual([]);
      expect(storedFiles(dataDir)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("M1 the page cannot skip the dialog: a direct call meets it too", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Any task" })]);
    const src = sourceFolder();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await nextConfirm(app, false);
      const result = await page.evaluate(
        (path) =>
          (window as unknown as { vesta: { assets: { importPath: (p: unknown) => Promise<{ ok: boolean; error?: { code: string } }> } } }).vesta.assets.importPath({
            path,
            scope: "details",
          }),
        join(src, "contract.pdf"),
      );
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("CANCELLED");
      expect(await confirmRequests(app)).toEqual([{ name: "contract.pdf", folder: realpathSync(src) }]);
      expect(storedFiles(dataDir)).toEqual([]);
    } finally {
      await app.close();
      rmSync(src, { recursive: true, force: true });
    }
  });

  test("M1 a dropped file asks nothing (the user chose it); the picker is covered by the handler test", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Link file", detailsMd: "notes" });
    seedTasks(dataDir, [a]);
    const src = sourceFolder();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openDetails(page, "Link file");
      await dropFile(details(page), join(src, "contract.pdf"));
      await expect.poll(() => storedFiles(dataDir).length).toBe(1);
      expect(await confirmRequests(app)).toEqual([]);
    } finally {
      await app.close();
      rmSync(src, { recursive: true, force: true });
    }
  });
});

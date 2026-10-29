// 005 US6, FR-038: when the editor cannot load, a plain markdown field takes its place (quickstart 16, T063).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const MESSAGE = "The Milkdown editor could not load, so a plain markdown field is shown. See Settings → Logs.";
const failNext = (page: Page) => page.evaluate(() => window.__vestaTest?.failEditorImport());
const logText = (dataDir: string) => readFileSync(join(dataDir, "logs", "vesta-001.log"), "utf8");

test.describe("005 US6 — the editor fallback (FR-038)", () => {
  test("the inline editor falls back to a plain field; Enter saves; the error is logged", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Plain **title**" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await failNext(page);
      await taskCard(page, "Plain title").locator(".title").dblclick();
      const field = page.locator("li[data-kind='task'] textarea.md-fallback");
      await expect(field).toBeFocused();
      await expect(field).toHaveValue("Plain **title**");
      await expect(page.locator("li[data-kind='task'] .md-fallback-note")).toHaveText(MESSAGE);
      await field.fill("Edited *in* plain");
      await field.press("Enter");
      await expect.poll(() => readTask(dataDir, a.id)?.title_md).toBe("Edited *in* plain");
      await expect.poll(() => logText(dataDir)).toContain("editor import failed");
    } finally {
      await app.close();
    }
  });

  test("the panel falls back to plain fields; the details still save after 500 ms", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Panel task", detailsMd: "old" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await failNext(page);
      await taskCard(page, "Panel task").locator(".title").click();
      const panel = page.getByRole("complementary", { name: "Details" });
      const details = panel.getByRole("textbox", { name: "Details" });
      await expect(details).toHaveValue("old");
      await expect(panel.locator(".md-fallback-note").first()).toHaveText(MESSAGE);
      await details.fill("new **details**");
      await expect(panel.locator(".saved")).toHaveText("Saved");
      expect(readTask(dataDir, a.id)?.details_md).toBe("new **details**");
      // The next panel loads the live editor again.
      await page.keyboard.press("Escape");
      await taskCard(page, "Panel task").locator(".title").click();
      await expect(panel.locator(".ProseMirror")).toHaveCount(2);
    } finally {
      await app.close();
    }
  });
});

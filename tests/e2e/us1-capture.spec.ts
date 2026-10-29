import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchVesta, relaunch } from "./fixtures/launch";

const taskList = (page: Page) => page.getByRole("list", { name: "Tasks" });
const cards = (page: Page) => taskList(page).locator("li[data-kind='task']");
const titles = async (page: Page) => (await cards(page).locator(".title").allTextContents()).map((s) => s.trim());

async function addTask(page: Page, title: string) {
  const editor = page.getByRole("textbox", { name: "New task…" });
  if (!(await editor.isVisible())) await page.getByRole("button", { name: "New task…" }).click();
  await editor.fill(title);
  await editor.press("Enter");
}

test.describe("US1 — capture tasks and keep them across restarts", () => {
  test("empty list shows only the empty card with its prompt; Enter adds; card stays ready (SC-001)", async () => {
    const started = performance.now();
    const { app, page } = await launchVesta();
    try {
      // The empty state and the footer row that adds (HIG identity, B · Hearth).
      await expect(taskList(page).getByRole("listitem")).toHaveCount(2);
      // 007 FR-037: the prompt names the current New task combination.
      const key = process.platform === "darwin" ? "⌘N" : "Ctrl+N";
      await expect(page.getByTestId("empty-tasks")).toContainText(`Add a task and Vesta keeps it in sight; press ${key} or type below.`);
      await expect(page.getByRole("button", { name: "New task…" })).toBeVisible();

      await addTask(page, "Renew passport");
      await expect(cards(page)).toHaveCount(1);
      expect(await titles(page)).toEqual(["Renew passport"]);
      expect(performance.now() - started).toBeLessThan(10_000); // SC-001

      const editor = page.getByRole("textbox", { name: "New task…" });
      await expect(editor).toBeFocused();
      await expect(editor).toHaveText("");
    } finally {
      await app.close();
    }
  });

  test("empty or whitespace text creates nothing on Enter, Esc or click outside; Esc discards typed text", async () => {
    const { app, page } = await launchVesta();
    try {
      await page.getByRole("button", { name: "New task…" }).click();
      const editor = page.getByRole("textbox", { name: "New task…" });
      await editor.fill("   ");
      await editor.press("Enter");
      await expect(cards(page)).toHaveCount(0);

      await page.getByRole("button", { name: "New task…" }).click();
      await editor.press("Escape");
      await expect(cards(page)).toHaveCount(0);

      await page.getByRole("button", { name: "New task…" }).click();
      await editor.fill("  ");
      await page.locator("header").click();
      await expect(cards(page)).toHaveCount(0);

      await page.getByRole("button", { name: "New task…" }).click();
      await editor.fill("Typed then discarded");
      await editor.press("Escape");
      await expect(cards(page)).toHaveCount(0);
      await page.getByRole("button", { name: "New task…" }).click();
      await expect(editor).toHaveText("");
    } finally {
      await app.close();
    }
  });

  test("tasks survive a relaunch in the same order", async () => {
    let run = await launchVesta();
    for (const t of ["One", "Two", "Three"]) await addTask(run.page, t);
    await expect(cards(run.page)).toHaveCount(3);
    run = await relaunch(run);
    try {
      expect(await titles(run.page)).toEqual(["One", "Two", "Three"]);
    } finally {
      await run.app.close();
    }
  });

  test("a second launch exits and brings the first window back (FR-004)", async () => {
    const { app, page, dataDir } = await launchVesta();
    try {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.minimize();
      });
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true);

      const env: NodeJS.ProcessEnv = { ...process.env, VESTA_DATA_DIR: dataDir };
      delete env["ELECTRON_RUN_AS_NODE"];
      const electronBin = resolve(import.meta.dirname, "../../node_modules/.bin/electron");
      const second = spawn(electronBin, [resolve(import.meta.dirname, "../../out/main/index.js")], { env, stdio: "ignore" });
      const code = await new Promise<number | null>((done) => second.on("exit", done));
      expect(code).toBe(0);

      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(false);
      await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();
    } finally {
      await app.close();
    }
  });
});

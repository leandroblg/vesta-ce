// 010 US6 (L1, L16; FR-009, FR-026): oversized input is refused, and a broken Vesta stops rather than carrying on.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { caretAtEnd, typeIn } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const toast = (page: Page) => page.getByTestId("notification");

function logText(dataDir: string): string {
  if (!existsSync(join(dataDir, "logs"))) return "";
  return readdirSync(join(dataDir, "logs"))
    .map((f) => readFileSync(join(dataDir, "logs", f), "utf8"))
    .join("");
}

const throwUncaught = (app: ElectronApplication) =>
  app.evaluate(() => {
    (globalThis as unknown as { __vestaTest: { throwUncaught: () => void } }).__vestaTest.throwUncaught();
  });

test.describe("010 US6 — oversized input is refused and a broken Vesta stops", () => {
  test("L1 a 10,001-character title is refused with the usual notice; 10,000 characters save", async () => {
    const { app, page, dataDir } = await launchVesta();
    try {
      await page.getByRole("button", { name: "New task…" }).click();
      const editor = page.getByRole("textbox", { name: "New task…" });
      await editor.fill("x".repeat(10_001));
      await editor.press("Enter");
      await expect(toast(page)).toContainText("Changes are not saved");
      expect(await page.locator("li[data-kind='task']").count()).toBe(0);
      await expect.poll(() => logText(dataDir)).toMatch(/"ipc\.invalid"[^\n]*"channel":"tasks:create"/);
      expect(logText(dataDir)).not.toContain("x".repeat(200));
      await toast(page).getByRole("button", { name: "Close" }).click();
      // Closing the notice moved the focus out, which closed the empty card (002): open it again.
      await page.getByRole("button", { name: "New task…" }).click();
      await editor.fill("y".repeat(10_000));
      await editor.press("Enter");
      await expect(page.locator("li[data-kind='task']")).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test("L16 an uncaught exception saves the pending edit, quits with code 1, and the next start says so once", async () => {
    test.setTimeout(90_000);
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Keep typing", detailsMd: "" });
    seedTasks(dataDir, [a]);
    let { app, page } = await launchVesta({ dataDir });
    await taskCard(page, "Keep typing").locator(".title").click();
    await expect(details(page)).toBeVisible();
    await caretAtEnd(details(page));
    await typeIn(details(page), "written just before the crash");
    const exited = new Promise<number | null>((resolve) => {
      app.process().once("exit", (code) => {
        resolve(code);
      });
    });
    await throwUncaught(app);
    const code = await exited;
    expect(code).toBe(1);
    const log = logText(dataDir);
    expect(log.split('"main.uncaught-exception"').length - 1).toBe(1);
    const marker = join(dataDir, "abnormal-exit.json");
    expect(existsSync(marker)).toBe(true);
    const parsed = JSON.parse(readFileSync(marker, "utf8")) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["at"]);
    expect(typeof parsed["at"]).toBe("number");
    expect(readTask(dataDir, a.id)?.details_md).toContain("written just before the crash");

    ({ app, page } = await launchVesta({ dataDir }));
    try {
      await expect(toast(page)).toContainText("Vesta closed after an unexpected problem");
      expect(existsSync(marker)).toBe(false);
      await toast(page).getByTestId("abnormal-exit-logs").click();
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
      await expect(page.locator("#set-logs-h")).toBeFocused();
    } finally {
      await app.close();
    }

    ({ app, page } = await launchVesta({ dataDir }));
    try {
      await expect(taskCard(page, "Keep typing")).toBeVisible();
      await page.waitForTimeout(500);
      await expect(toast(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

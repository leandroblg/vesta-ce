import { expect, test, type Page } from "@playwright/test";
import { IS_MAC } from "./fixtures/settings";
import { launchVesta, relaunch } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";

const card = (page: Page, title: string) => page.locator("li[data-kind='task']").filter({ hasText: title });
const editor = (page: Page) => page.locator("li[data-kind='task'] [role='textbox']");

test.describe("US2 — edit titles inline", () => {
  test("double-click and the Edit button start editing with the hint; Enter and click outside save", async () => {
    let run = await launchVesta({ dataDir: undefined });
    const { page } = run;
    await page.getByRole("button", { name: "New task…" }).click();
    await page.getByRole("textbox", { name: "New task…" }).fill("Fix bike");
    await page.getByRole("textbox", { name: "New task…" }).press("Enter");
    await page.getByRole("textbox", { name: "New task…" }).press("Escape");

    await card(page, "Fix bike").locator(".title").dblclick();
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveAccessibleName("Fix bike");
    await expect(page.getByText(`${IS_MAC ? "Return" : "Enter"} to save · Esc to cancel`)).toBeVisible();
    await editor(page).fill("Fix the bike");
    await editor(page).press("Enter");
    await expect(card(page, "Fix the bike")).toBeVisible();

    await clickRevealed(card(page, "Fix the bike"), card(page, "Fix the bike").getByRole("button", { name: "Edit" }));
    await editor(page).fill("Fix the red bike");
    await page.locator("header").click();
    await expect(card(page, "Fix the red bike")).toBeVisible();

    run = await relaunch(run);
    try {
      await expect(card(run.page, "Fix the red bike")).toBeVisible();
    } finally {
      await run.app.close();
    }
  });

  test("Esc restores; an emptied title restores the last saved one", async () => {
    const { app, page } = await launchWith(["Renew passport"]);
    try {
      await card(page, "Renew passport").locator(".title").dblclick();
      await editor(page).fill("Something else");
      await editor(page).press("Escape");
      await expect(card(page, "Renew passport")).toBeVisible();

      await card(page, "Renew passport").locator(".title").dblclick();
      await editor(page).fill("   ");
      await editor(page).press("Enter");
      await expect(card(page, "Renew passport")).toBeVisible();
      await expect(editor(page)).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("nothing is saved while typing: a force-kill keeps the old title", async () => {
    const run = await launchWith(["Draft summary"]);
    await card(run.page, "Draft summary").locator(".title").dblclick();
    await editor(run.page).fill("Draft the summary");
    run.app.process().kill("SIGKILL");
    const next = await launchVesta({ dataDir: run.dataDir });
    try {
      await expect(card(next.page, "Draft summary")).toBeVisible();
    } finally {
      await next.app.close();
    }
  });

  test("closing the window mid-edit saves the typed title (FR-018, FR-004a)", async () => {
    const run = await launchWith(["Book dentist"]);
    await card(run.page, "Book dentist").locator(".title").dblclick();
    await editor(run.page).fill("Book the dentist");
    const exited = new Promise<void>((done) => run.app.process().once("exit", () => { done(); }));
    await run.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    if (process.platform === "darwin") {
      // macOS: the window hides, the process keeps running; a Dock click shows it again.
      await expect.poll(() => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false);
      await run.app.evaluate(({ app }) => {
        app.emit("activate");
      });
      await expect.poll(() => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
      await expect(card(run.page, "Book the dentist")).toBeVisible();
      await run.app.close();
    } else {
      await exited; // Windows and Linux: closing quits.
    }
    const next = await launchVesta({ dataDir: run.dataDir });
    try {
      await expect(card(next.page, "Book the dentist")).toBeVisible();
    } finally {
      await next.app.close();
    }
  });
});

async function launchWith(titles: string[]) {
  const { freshDataDir } = await import("./fixtures/launch");
  const dataDir = freshDataDir();
  seedTasks(
    dataDir,
    titles.map((titleMd, i) => task({ titleMd, position: i + 1 })),
  );
  return launchVesta({ dataDir });
}

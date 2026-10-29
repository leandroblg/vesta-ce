/** US1 — find an active task or reminder by typing (006 quickstart 1–4; FR-001 to FR-005, FR-010, FR-012, FR-015, FR-022). */
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { exactPhraseToggle, highlights, matchCaseToggle, search, searchBox, searchSettled } from "./fixtures/search";

const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());
const reminderTexts = async (page: Page) => (await page.locator("li[data-kind='rem'] .title").allTextContents()).map((s) => s.trim());

function seedBasic(dataDir: string) {
  const parent = task({ titleMd: "Prepare quarterly report", position: 1 });
  seedTasks(dataDir, [
    task({ titleMd: "Renew passport", position: 0 }),
    parent,
    task({ titleMd: "Gather sales numbers", parentId: parent.id, position: 1 }),
    task({ titleMd: "Fix bike", position: 2 }),
    task({ titleMd: "Sales report", position: 3 }),
    task({ titleMd: "Report on sales", position: 4 }),
    task({ titleMd: "API keys", position: 5 }),
    task({ titleMd: "rapid fix", position: 6 }),
    task({ titleMd: "Fri**day** review", position: 7 }),
  ]);
  seedReminders(dataDir, [
    reminder({ textMd: "Call the bank before **Friday**", position: 1 }),
    reminder({ textMd: "Pick up _dry cleaning_", position: 2 }),
  ]);
}

test.describe("006 US1 — filter as you type", () => {
  test("filters after each character, keeps the order, and highlights every match (1)", async () => {
    const dataDir = freshDataDir();
    seedBasic(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const before = await taskTitles(page);
      await searchBox(page).click();
      for (const ch of "pass") {
        await page.keyboard.type(ch);
        await searchSettled(page);
      }
      expect(await taskTitles(page)).toEqual(["Renew passport"]);
      expect(await reminderTexts(page)).toEqual([]);
      expect(await highlights(page)).toEqual(["pass"]);
      // Highlight style: background plus underline, not color alone (FR-012).
      const style = await page.evaluate(() => {
        const probe = [...document.styleSheets].flatMap((s) => [...s.cssRules]).find((r) => r.cssText.includes("::highlight(vesta-search)"));
        return probe?.cssText ?? "";
      });
      expect(style).toMatch(/text-decoration/);
      await searchBox(page).fill("");
      expect(await taskTitles(page)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  test("ignores formatting, case and accents; highlights across formatting runs (2)", async () => {
    const dataDir = freshDataDir();
    seedBasic(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "before friday");
      expect(await reminderTexts(page)).toEqual(["Call the bank before Friday"]);
      await search(page, "friday");
      expect(await taskTitles(page)).toEqual(["Friday review"]);
      expect(await highlights(page)).toContain("Friday");
    } finally {
      await app.close();
    }
  });

  test("Exact phrase and Match case narrow the results, and a toggle press re-runs the search (3)", async () => {
    const dataDir = freshDataDir();
    seedBasic(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "sales report");
      expect((await taskTitles(page)).sort()).toEqual(["Report on sales", "Sales report"]);
      await search(page, "sales report", { exactPhrase: true });
      expect(await taskTitles(page)).toEqual(["Sales report"]);
      await expect(exactPhraseToggle(page)).toBeChecked();
      await search(page, "API");
      expect((await taskTitles(page)).sort()).toEqual(["API keys", "rapid fix"]);
      await matchCaseToggle(page).click();
      await searchSettled(page);
      expect(await taskTitles(page)).toEqual(["API keys"]);
    } finally {
      await app.close();
    }
  });

  test("spaces only is no search; no matches shows a line per section; every way of clearing restores the view (4)", async () => {
    const dataDir = freshDataDir();
    seedBasic(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const before = await taskTitles(page);
      await searchBox(page).fill("    ");
      expect(await taskTitles(page)).toEqual(before);
      await search(page, "zzzz");
      await expect(page.getByText("No matches for “zzzz”.")).toHaveCount(2);
      // Clear button.
      await page.getByRole("button", { name: "Clear search" }).click();
      expect(await taskTitles(page)).toEqual(before);
      await expect(searchBox(page)).toHaveValue("");
      // Esc in the box.
      await search(page, "bike");
      await searchBox(page).press("Escape");
      await expect(searchBox(page)).toHaveValue("");
      await expect(searchBox(page)).toBeFocused();
      expect(await taskTitles(page)).toEqual(before);
      // Deleting the text.
      await search(page, "bike");
      await searchBox(page).fill("");
      expect(await taskTitles(page)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  test("a section with no active items keeps its empty card and shows no 'No matches' line (FR-010)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Only task" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "zzzz");
      await expect(page.getByText("No matches for “zzzz”.")).toHaveCount(1);
      // The empty Reminders section keeps its empty card (with its prompt); the Tasks section shows the line.
      await expect(page.locator("li[data-kind='new-rem']")).toHaveCount(1);
      await expect(page.locator("section[aria-labelledby='rem-h']").getByText("No matches for “zzzz”.")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

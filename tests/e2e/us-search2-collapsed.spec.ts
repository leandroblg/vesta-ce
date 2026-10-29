/** US2 — matches in subtasks, details and collapsed places (006 quickstart 5–7; FR-003, FR-006 to FR-008, FR-013 to FR-015, FR-024). */
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { reminder, seedReminders, seedSetting, seedTasks, task } from "./fixtures/seed";
import { exactPhraseToggle, highlights, includeArchiveTrash, matchCaseToggle, search, searchBox, openSearchOptions } from "./fixtures/search";

const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());
const reminderTexts = async (page: Page) => (await page.locator("li[data-kind='rem'] .title").allTextContents()).map((s) => s.trim());

function storedCollapse(dataDir: string): { tasks: Record<string, number>; reminders: string | null } {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    const rows = db.prepare("select title_md, collapsed from tasks").all() as { title_md: string; collapsed: number }[];
    const rem = db.prepare("select value from settings where key = 'remindersCollapsed'").pluck().get() as string | undefined;
    return { tasks: Object.fromEntries(rows.map((r) => [r.title_md, r.collapsed])), reminders: rem ?? null };
  } finally {
    db.close();
  }
}

function seedCollapsed(dataDir: string) {
  const parent = task({ titleMd: "Office admin", collapsed: true, position: 1 });
  seedTasks(dataDir, [
    parent,
    task({ titleMd: "Pay supplier", parentId: parent.id, position: 1, detailsMd: "paid by bank transfer, invoice **2291**, due Friday" }),
    task({ titleMd: "File receipts", parentId: parent.id, position: 2 }),
    task({ titleMd: "Fix bike", position: 2 }),
    task({
      titleMd: "Rich notes",
      position: 3,
      detailsMd: [
        "See [the signed form](https://example.com/secret-path) here.",
        "",
        "| Item | Qty |",
        "| --- | --- |",
        "| pumpkins | 3 |",
        "",
        "```js",
        "const answer = 42;",
        "```",
        "",
        "<details><summary>More</summary>",
        "",
        "hiddenword inside",
        "",
        "</details>",
        "",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      ].join("\n"),
    }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "Call the bank", position: 1 }), reminder({ textMd: "Water plants", position: 2 })]);
  seedSetting(dataDir, "remindersCollapsed", true);
}

test.describe("006 US2 — subtasks, details and collapsed places", () => {
  test("a details match under a collapsed parent shows the parent with that subtask and an excerpt; clearing collapses it again (5)", async () => {
    const dataDir = freshDataDir();
    seedCollapsed(dataDir);
    const before = storedCollapse(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      expect(await taskTitles(page)).toEqual(["Office admin", "Fix bike", "Rich notes"]);
      await search(page, "2291");
      expect(await taskTitles(page)).toEqual(["Office admin", "Pay supplier"]);
      const excerpt = page.locator("li[data-kind='task'] .search-excerpt");
      await expect(excerpt).toHaveText("paid by bank transfer, invoice 2291, due Friday");
      expect(await highlights(page)).toEqual(["2291"]);
      // A reminder in the collapsed Reminders section shows (FR-007).
      await search(page, "bank");
      expect(await reminderTexts(page)).toEqual(["Call the bank"]);
      // Clearing: both collapse states return, and nothing was written (FR-015, SC-003).
      await searchBox(page).fill("");
      expect(await taskTitles(page)).toEqual(["Office admin", "Fix bike", "Rich notes"]);
      expect(await reminderTexts(page)).toEqual([]);
      expect(storedCollapse(dataDir)).toEqual(before);
    } finally {
      await app.close();
    }
  });

  test("collapse toggles are inert while searching; a restart starts with an empty box, toggles off, checkbox unticked (6)", async () => {
    const dataDir = freshDataDir();
    seedCollapsed(dataDir);
    const before = storedCollapse(dataDir);
    let run = await launchVesta({ dataDir });
    try {
      await search(run.page, "2291", { matchCase: true, includeArchiveTrash: true });
      const parent = run.page.locator("li[data-kind='task']").filter({ hasText: "Office admin" });
      // The toggle becomes blank space: hidden (so out of the accessibility tree and tab order) and inert.
      await expect(parent.locator("button.twisty")).toBeHidden();
      await expect(parent.getByRole("button", { name: /^(Expand|Collapse)$/ })).toHaveCount(0);
      await expect(run.page.locator("section[aria-labelledby='rem-h'] button.sec-toggle")).toHaveCount(0);
      run = await relaunch(run);
      await expect(searchBox(run.page)).toHaveValue("");
      await openSearchOptions(run.page);
      await expect(matchCaseToggle(run.page)).not.toBeChecked();
      await expect(exactPhraseToggle(run.page)).not.toBeChecked();
      await expect(includeArchiveTrash(run.page)).not.toBeChecked();
      expect(storedCollapse(dataDir)).toEqual(before);
    } finally {
      await run.app.close();
    }
  });

  test("finds link text, table cells, code and a collapsed section's content, never a link address or a YouTube URL (7)", async () => {
    const dataDir = freshDataDir();
    seedCollapsed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      for (const word of ["signed form", "pumpkins", "answer = 42", "hiddenword"]) {
        await search(page, word);
        expect(await taskTitles(page), word).toEqual(["Rich notes"]);
      }
      for (const word of ["secret-path", "dQw4w9WgXcQ", "youtube"]) {
        await search(page, word);
        expect(await taskTitles(page), word).toEqual([]);
      }
    } finally {
      await app.close();
    }
  });

  test("only matching items are highlighted: a parent shown as context is not (FR-006, FR-012)", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Report folder", position: 1 });
    seedTasks(dataDir, [parent, task({ titleMd: "Report invoice", parentId: parent.id, position: 1, detailsMd: "number 2291" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "report 2291");
      expect(await taskTitles(page)).toEqual(["Report folder", "Report invoice"]);
      // The subtask's title and its excerpt; not the parent's "Report".
      expect((await highlights(page)).sort()).toEqual(["2291", "Report"]);
      await expect(page.locator("li[data-kind='task']").filter({ hasText: "Report folder" }).locator(".title[data-hl]")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("the details panel shows no search highlight (FR-014)", async () => {
    const dataDir = freshDataDir();
    seedCollapsed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "pumpkins");
      await page.locator("li[data-kind='task'] .title", { hasText: "Rich notes" }).click();
      const panel = page.locator(".panel, [role='region'][aria-label*='Rich notes'], aside").first();
      await expect(panel).toBeVisible();
      const inPanel = await page.evaluate(() => {
        const h = CSS.highlights.get("vesta-search");
        const panelEl = document.querySelector("aside");
        if (h === undefined || panelEl === null) return 0;
        return [...h].filter((r) => panelEl.contains((r as Range).commonAncestorContainer)).length;
      });
      expect(inPanel).toBe(0);
    } finally {
      await app.close();
    }
  });
});

/** The runbook's card 006 hand checks (step L), automated (006 quickstart 18). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readTitles } from "./fixtures/drag";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, seedTasks, task } from "./fixtures/seed";
import { elsewhereSection, highlights, search, searchBox } from "./fixtures/search";

const taskTitles = async (page: Page) => (await page.locator("li[data-kind='task'] .title").allTextContents()).map((s) => s.trim());

test("runbook card 006 step L", async () => {
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Home", collapsed: true, position: 2 });
  seedTasks(dataDir, [
    task({ titleMd: "Renew **passport** soon", position: 1 }),
    parent,
    task({ titleMd: "Fix the gate", parentId: parent.id, position: 1 }),
    task({ titleMd: "Old gate quote", doneAt: Date.now() - DAY }),
    task({ titleMd: "Other", position: 3 }),
  ]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    // "Searching a bold word finds it; matches are highlighted."
    await search(page, "passport");
    expect(await taskTitles(page)).toEqual(["Renew passport soon"]);
    expect(await highlights(page)).toEqual(["passport"]);
    // "A matching subtask shows inside a collapsed parent; clearing the search collapses it again."
    await search(page, "gate");
    expect(await taskTitles(page)).toEqual(["Home", "Fix the gate"]);
    await searchBox(page).fill("");
    expect(await taskTitles(page)).toEqual(["Renew passport soon", "Home", "Other"]);
    // "The checkbox adds Archive and Trash matches in their own section."
    await search(page, "gate", { includeArchiveTrash: true });
    await expect(elsewhereSection(page).locator("li.arow .title")).toHaveText(["Old gate quote"]);
    // "Dragging does nothing while a search is active."
    await search(page, "o");
    const before = await readTitles(page);
    expect(await dragTo(page, taskCard(page, "Other"), { row: taskCard(page, "Renew passport soon"), zone: "upper" })).toBeNull();
    expect(await readTitles(page)).toEqual(before);
  } finally {
    await app.close();
  }
});

/** Accessibility of the 006 search (quickstart 15; FR-001, FR-008, FR-012, FR-013, FR-018, FR-023, SC-007). */
import { expect, test } from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures/axe";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { elsewhereSection, exactPhraseToggle, includeArchiveTrash, matchCaseToggle, search, searchBox } from "./fixtures/search";

function seed(dataDir: string) {
  const parent = task({ titleMd: "Office report", collapsed: true, position: 1 });
  seedTasks(dataDir, [
    parent,
    task({ titleMd: "Pay supplier", parentId: parent.id, position: 1, detailsMd: "the quarterly report is attached" }),
    task({ titleMd: "Report expenses", position: 2 }),
    task({ titleMd: "Old report", doneAt: Date.now() - DAY }),
    task({ titleMd: "Trashed report", deletedAt: Date.now() - DAY }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "Send the report", position: 1 })]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`axe: results, highlights, pressed toggles, an excerpt and the Archive and Trash section pass in ${colorScheme} mode`, async () => {
    const dataDir = freshDataDir();
    seed(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ colorScheme });
      await search(page, "report", { matchCase: false, exactPhrase: false, includeArchiveTrash: true });
      await matchCaseToggle(page).click();
      await exactPhraseToggle(page).click();
      await search(page, "report", { includeArchiveTrash: true });
      await expect(page.locator(".search-excerpt")).toHaveCount(1);
      await expect(elsewhereSection(page)).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: search results`);
    } finally {
      await app.close();
    }
  });
}

test("names, pressed states, section structure and tab order (FR-001, FR-008, FR-018, FR-023)", async () => {
  const dataDir = freshDataDir();
  seed(dataDir);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await search(page, "report", { includeArchiveTrash: true });
    await expect(matchCaseToggle(page)).not.toBeChecked();
    await expect(exactPhraseToggle(page)).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Clear search" })).toBeVisible();
    await expect(includeArchiveTrash(page)).toBeChecked();
    // The section: a level-2 heading like Reminders and Tasks, a list, and named Restore buttons.
    await expect(elsewhereSection(page).getByRole("heading", { level: 2 })).toHaveText("Matches in Archive and Trash");
    await expect(elsewhereSection(page).getByRole("list")).toBeVisible();
    await expect(elsewhereSection(page).getByRole("button", { name: "Restore: Old report" })).toBeVisible();
    // While searching, a parent exposes no expanded or collapsed state; the excerpt follows the title.
    const parent = page.locator("li[data-kind='task']").filter({ hasText: "Office report" });
    await expect(parent.locator("button.twisty")).toBeHidden();
    await expect(parent.getByRole("button", { name: /^(Expand|Collapse)$/ })).toHaveCount(0);
    const sub = page.locator("li[data-kind='task']").filter({ hasText: "Pay supplier" });
    const order = await sub.evaluate((li) => {
      const title = li.querySelector(".title");
      const excerpt = li.querySelector(".search-excerpt");
      return title !== null && excerpt !== null && Boolean(title.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
    // Tab order: box → clear → Search options → the scope (one stop, its checked option: Everything here) → Match case →
    // Exact phrase (013 FR-036, FR-038).
    await searchBox(page).focus();
    const names: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      names.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.closest("label")?.textContent ?? document.activeElement?.textContent ?? ""));
    }
    expect(names.map((n) => n.replace(/\d+/g, "").trim())).toEqual(["Clear search", "Search options", "Everything", "Match case", "Exact phrase"]);
  } finally {
    await app.close();
  }
});

test("the scope bar's checkbox labels have the font, size and color of the Archive and Trash buttons", async () => {
  const dataDir = freshDataDir();
  seed(dataDir);
  const { app, page } = await launchVesta({ dataDir });
  try {
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      const styles = await page.evaluate(() => {
        const pick = (sel: string) => {
          const el = document.querySelector(sel);
          if (el === null) return null;
          const c = getComputedStyle(el);
          return { family: c.fontFamily, size: c.fontSize, weight: c.fontWeight, color: c.color };
        };
        return { label: pick(".search .chk span"), archive: pick(".navbtn .lbl"), trash: pick(".navbtn:nth-of-type(2) .lbl") };
      });
      expect(styles.label, colorScheme).not.toBeNull();
      expect(styles.label, colorScheme).toEqual(styles.archive);
      expect(styles.label, colorScheme).toEqual(styles.trash);
    }
  } finally {
    await app.close();
  }
});


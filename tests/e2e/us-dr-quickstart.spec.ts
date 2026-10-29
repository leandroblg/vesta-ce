// 012 step L, automated (quickstart scenarios 1, 3, 5, 7, 8 and 9 in one profile; tasks T075).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, HOUR, advanceClock, readTask, tick } from "./fixtures/clock";
import { menu } from "./fixtures/editor";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, staleTask, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const button = (page: Page, cmd: string) => menu(page).locator(`button[data-cmd="${cmd}"]`);

async function place(editor: Locator, a: string, b?: string): Promise<void> {
  await editor.evaluate(
    (root: HTMLElement, [first, last]) => {
      root.focus();
      const find = (wanted: string) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(wanted) ?? -1;
          if (at >= 0) return { node, at };
        }
        throw new Error(wanted);
      };
      const start = find(first);
      const range = document.createRange();
      if (last === null) {
        range.setStart(start.node, start.at + 1);
        range.collapse(true);
      } else {
        const end = find(last);
        range.setStart(start.node, start.at);
        range.setEnd(end.node, end.at + last.length);
      }
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    [a, b ?? null] as const,
  );
}

test("012 quickstart: scope, alert period, checklist, font size, highlight, tables in one profile", async () => {
  test.setTimeout(120_000);
  const dataDir = freshDataDir();
  const notes = task({
    titleMd: "Notes",
    position: 1,
    detailsMd: "first\n\nsecond\n\nalpha\n\nbeta\n\nsay word now\n\na ==two words== b\n\n| h1 | h2 |\n| -- | -- |\n| a1 | a2 |\n\nend",
  });
  const late = staleTask({ titleMd: "Late", position: 2 });
  seedTasks(dataDir, [notes, late]);
  const { app, page } = await launchVesta({ dataDir });
  const stored = () => readTask(dataDir, notes.id)?.details_md ?? "";
  try {
    await tick(page);
    // Scenario 1: the menu's scope.
    await taskCard(page, "Notes").locator(".title").click();
    const editor = details(page);
    await editor.click();
    await place(editor, "second");
    await expect(menu(page).locator(".fm-scope")).toHaveText("Paragraph");
    await button(page, "strong").click();
    await expect.poll(stored).toContain("first\n\n**second**\n\nalpha");
    // Scenario 5: checklist on two paragraphs.
    await place(editor, "alpha", "beta");
    await button(page, "check").click();
    await expect.poll(stored).toContain("- [ ] alpha\n- [ ] beta");
    // Scenario 7: font size steps.
    await place(editor, "word", "word");
    await button(page, "size-up").click();
    await button(page, "size-up").click();
    await expect.poll(stored).toContain('say [word]{size="1.5em"} now');
    // Scenario 8: double click on a highlight, then Highlight removes it.
    await editor.locator("mark").dblclick();
    await button(page, "mark").click();
    await expect.poll(stored).toContain("a two words b");
    // Scenario 9: Delete table.
    await editor.locator("td", { hasText: "a1" }).click();
    await button(page, "table-delete").click();
    await expect.poll(stored).not.toContain("| h1 |");
    await page.keyboard.press("Escape");

    // Scenario 3: a 7-day override un-stales "Late", which goes stale again at creation + 7 days.
    const card = taskCard(page, "Late");
    await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "Alert Period…" }).click();
    const ov = page.getByRole("dialog", { name: "Alert override" });
    await ov.getByRole("checkbox", { name: /Use the global default/ }).uncheck();
    await ov.getByRole("spinbutton", { name: "Days" }).fill("7");
    await expect.poll(() => readTask(dataDir, late.id)?.stale_since ?? null).toBeNull();
    await page.keyboard.press("Escape");
    await expect(card).not.toHaveClass(/\bstale\b/);
    await advanceClock(app, 5 * DAY + HOUR);
    await tick(page);
    await expect(card).toHaveClass(/\bstale\b/);
  } finally {
    await app.close();
  }
});

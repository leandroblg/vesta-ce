/**
 * 016 User Story 5: typing `[ ] ` makes a checklist item, and Checklist off gives paragraphs back when the list stands
 * alone (FR-023 to FR-025; PRD Q225, Q231, Q240, Q253).
 */
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { readTask } from "./fixtures/clock";
import { caretAtEnd, menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { addReminder, reminderCard } from "./fixtures/reminders";
import { seedTasks, task } from "./fixtures/seed";

const mod = process.platform === "darwin" ? "Meta" : "Control";
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });

/** Selects from the start of `a` to the end of `b` in the details, through the DOM selection ProseMirror follows. */
async function selectAcross(page: Page, a: string, b: string): Promise<void> {
  await details(page).evaluate(
    (root: HTMLElement, { first, last }) => {
      root.focus();
      const find = (wanted: string): [Node, number] => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(wanted) ?? -1;
          if (at >= 0) return [node, at];
        }
        throw new Error(`text not found: ${wanted}`);
      };
      const [startNode, startAt] = find(first);
      const [endNode, endAt] = find(last);
      const range = document.createRange();
      range.setStart(startNode, startAt);
      range.setEnd(endNode, endAt + last.length);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    { first: a, last: b },
  );
}

/** Puts the caret right before `text` in the details. */
async function caretBefore(page: Page, text: string): Promise<void> {
  await details(page).evaluate((root: HTMLElement, wanted) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error(`text not found: ${wanted}`);
  }, text);
}

test.describe("016 US5 — checklists by typing, and Checklist off", () => {
  test("[ ], [x] and [] make checklist items in the details; a numbered item keeps its number; Undo brings the characters back", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Typing", detailsMd: "first\n\nsecond\n\n1. counted" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Typing").locator(".title").click();
      await caretBefore(page, "first");
      await page.keyboard.type("[ ] ");
      await caretBefore(page, "second");
      await page.keyboard.type("[x] ");
      await caretBefore(page, "counted");
      await page.keyboard.type("[] ");
      await expect(details(page).locator("li[data-item-type='task']")).toHaveCount(3);
      await page.keyboard.press("Escape");
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("- [ ] first\n- [x] second\n\n1. [ ] counted");

      await taskCard(page, "Typing").locator(".title").click();
      await caretAtEnd(details(page));
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("[ ] ");
      await expect(details(page).locator("li[data-item-type='task']")).toHaveCount(4);
      await page.keyboard.press(`${mod}+z`);
      await expect(details(page).locator("li[data-item-type='task']")).toHaveCount(3);
      await expect(details(page)).toContainText("[ ]");
    } finally {
      await app.close();
    }
  });

  test("a new task's title and a new reminder keep the characters as typed", async () => {
    const { app, page } = await launchVesta();
    try {
      await page.getByRole("button", { name: "New task…" }).click();
      const title = page.getByRole("textbox", { name: "New task…" });
      await title.pressSequentially("[ ] Buy milk");
      await expect(title).toHaveText("[ ] Buy milk");
      await expect(title.locator("li")).toHaveCount(0);
      await title.press("Enter");
      // (taskCard matches by a regular expression, which the brackets would break.)
      await expect(page.locator("li[data-kind='task'] .title", { hasText: "[ ] Buy milk" })).toHaveCount(1);
      await page.keyboard.press("Escape");

      await addReminder(page, "[x] Note");
      await expect(reminderCard(page, "[x] Note").locator("li")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("Checklist off: a stand-alone list becomes paragraphs; with a list directly below the items stay plain items", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Alone", detailsMd: "- [ ] one\n- [ ] two\n- [ ] three" });
    const b = task({ titleMd: "Neighbour", detailsMd: "- [ ] one\n- [ ] two\n\n1. other", position: 2 });
    seedTasks(dataDir, [a, b]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Alone").locator(".title").click();
      await selectAcross(page, "one", "three");
      await menu(page).locator('button[data-cmd="check"]').click();
      await page.keyboard.press("Escape");
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("one\n\ntwo\n\nthree");
      await page.keyboard.press("Escape");

      await taskCard(page, "Neighbour").locator(".title").click();
      await selectAcross(page, "one", "two");
      await menu(page).locator('button[data-cmd="check"]').click();
      await page.keyboard.press("Escape");
      await expect.poll(() => readTask(dataDir, b.id)?.details_md).toBe("- one\n- two\n\n1. other");
    } finally {
      await app.close();
    }
  });
});

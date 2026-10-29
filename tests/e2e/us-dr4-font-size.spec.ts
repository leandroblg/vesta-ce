// 012 US4: Increase and Decrease font size, one step at a time (quickstart scenario 7, tasks T053).
import { expect, test, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const up = (page: Page) => menu(page).getByRole("button", { name: "Increase font size" });
const down = (page: Page) => menu(page).getByRole("button", { name: "Decrease font size" });

async function launch(titleMd: string, detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd, detailsMd });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

const stored = (dataDir: string, id: string) => readTask(dataDir, id)?.details_md;

test.describe("012 US4 — font size steps", () => {
  test("FR-014 FR-015 two steps up, two down: the stored size, then none", async () => {
    const { app, page, dataDir, id } = await launch("Sizes", "say word now");
    try {
      await card(page).locator(".title").click();
      const editor = details(page);
      await selectText(editor, "word");
      await up(page).click();
      await up(page).click();
      await expect.poll(() => stored(dataDir, id)).toBe('say [word]{size="1.5em"} now');
      await down(page).click();
      await down(page).click();
      await expect.poll(() => stored(dataDir, id)).toBe("say word now");
    } finally {
      await app.close();
    }
  });

  test("FR-017 the buttons are unavailable at their ends; FR-016 an old 1.4em moves onto the ladder", async () => {
    const { app, page, dataDir, id } = await launch("Limits", '[big]{size="2.5em"} [small]{size="0.75em"} [old]{size="1.4em"}');
    try {
      await card(page).locator(".title").click();
      const editor = details(page);
      await selectText(editor, "big");
      await expect(up(page)).toHaveAttribute("aria-disabled", "true");
      await expect(down(page)).not.toHaveAttribute("aria-disabled", "true");
      await selectText(editor, "small");
      await expect(down(page)).toHaveAttribute("aria-disabled", "true");
      await selectText(editor, "old");
      await up(page).click();
      await expect.poll(() => stored(dataDir, id)).toBe('[big]{size="2.5em"} [small]{size="0.75em"} [old]{size="1.5em"}');
    } finally {
      await app.close();
    }
  });

  test("FR-014 a title steps as a whole and its row grows on the main view (A8)", async () => {
    const { app, page, dataDir, id } = await launch("Grow me", "");
    try {
      const before = (await card(page).boundingBox())?.height ?? 0;
      await card(page).locator(".title").dblclick();
      const editor = card(page).locator(".ProseMirror");
      await expect(editor).toBeFocused();
      for (let i = 0; i < 4; i++) await up(page).click();
      await editor.press("Enter");
      await expect.poll(() => readTask(dataDir, id)?.title_md).toBe('[Grow me]{size="2.5em"}');
      await expect.poll(async () => (await card(page).boundingBox())?.height ?? 0).toBeGreaterThan(before);
    } finally {
      await app.close();
    }
  });

  test("FR-014 inside a heading the size multiplies the heading's own size", async () => {
    const { app, page } = await launch("Heading", '# Head [part]{size="1.25em"}');
    try {
      await card(page).locator(".title").click();
      const ratio = await details(page).evaluate((root) => {
        const h = root.querySelector("h1");
        const span = root.querySelector("[data-size]");
        return h && span ? Number.parseFloat(getComputedStyle(span).fontSize) / Number.parseFloat(getComputedStyle(h).fontSize) : 0;
      });
      expect(ratio).toBeCloseTo(1.25, 2);
    } finally {
      await app.close();
    }
  });
});

/** Virtualized search lists (006 SC-001, T053): only rows near the viewport render, every match stays reachable. */
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedSearchSet, seedTasks, task } from "./fixtures/seed";
import { expectNoA11yViolations } from "./fixtures/axe";
import { elsewhereSection, highlights, search } from "./fixtures/search";

const taskRows = (page: Page) => page.locator("li[data-kind='task']");
const scrollMainTo = (page: Page, where: "bottom" | "top") =>
  page.evaluate((w) => {
    const main = document.querySelector(".main");
    if (main !== null) main.scrollTop = w === "bottom" ? main.scrollHeight : 0;
  }, where);

test.describe("006 virtualized search lists", () => {
  test("a search matching 1,000 tasks renders a window of rows; scrolling reaches the last match, highlighted", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "notes about", { exactPhrase: true });
      const rendered = await taskRows(page).count();
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(200);
      await expect(page.locator("li.vspacer").first()).toBeAttached();
      // The first match is at the top.
      await expect(taskRows(page).first().locator(".title")).toHaveText(/^Task 0 /);
      // Scrolling to the bottom renders the last match.
      await scrollMainTo(page, "bottom");
      await expect(page.locator("li[data-kind='task'] .title", { hasText: /^Task 999 / })).toBeVisible();
      await expect.poll(async () => (await highlights(page)).length).toBeGreaterThan(0);
      // And back to the top.
      await scrollMainTo(page, "top");
      await expect(taskRows(page).first().locator(".title")).toHaveText(/^Task 0 /);
    } finally {
      await app.close();
    }
  });

  test("keyboard focus moving down the rows scrolls them into view, so rows beyond the window render", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "notes about", { exactPhrase: true });
      const firstIds = await taskRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
      // Move focus row by row through the done checkboxes, well past the first window.
      await taskRows(page).first().getByRole("checkbox").focus();
      for (let i = 0; i < 120; i++) {
        await page.evaluate(() => {
          const rows = [...document.querySelectorAll<HTMLElement>("li[data-kind='task']")];
          const at = rows.findIndex((r) => r.contains(document.activeElement));
          rows[at + 1]?.querySelector<HTMLInputElement>("input.cb")?.focus();
        });
      }
      const focusedTitle = await page.evaluate(() => document.activeElement?.closest("li")?.querySelector(".title")?.textContent ?? "");
      expect(focusedTitle).toMatch(/^Task (1[2-9]\d|[2-9]\d\d) /);
      const nowIds = await taskRows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-id")));
      expect(nowIds).not.toEqual(firstIds);
    } finally {
      await app.close();
    }
  });

  test("small result sets render in full, with no spacers", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, Array.from({ length: 60 }, (_, i) => task({ titleMd: `Item ${String(i)}`, position: i + 1 })));
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "item");
      await expect(taskRows(page)).toHaveCount(60);
      await expect(page.locator("li.vspacer")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("the Archive and Trash section virtualizes too and still reaches its last row", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "Old", { matchCase: true, includeArchiveTrash: true });
      const rows = elsewhereSection(page).locator("li.arow");
      expect(await rows.count()).toBeLessThan(400);
      await scrollMainTo(page, "bottom");
      // Newest first: the oldest item, "Old 999", is last.
      await expect(elsewhereSection(page).locator("li.arow .title", { hasText: /^Old 999 / })).toBeVisible();
    } finally {
      await app.close();
    }
  });
  test("rendered rows report their position and the total to screen readers (T056)", async () => {
    const dataDir = freshDataDir();
    seedSearchSet(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "notes about", { exactPhrase: true });
      const first = taskRows(page).first();
      await expect(first).toHaveAttribute("aria-posinset", "1");
      await expect(first).toHaveAttribute("aria-setsize", "1000");
      await scrollMainTo(page, "bottom");
      const last = page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: /^Task 999 / }) });
      await expect(last).toHaveAttribute("aria-posinset", "1000");
      // Small result sets render in full and need no position attributes.
      await search(page, "task 777 ", { exactPhrase: true });
      await expect(taskRows(page)).toHaveCount(1);
      await expect(page.locator("li[data-kind='task'][aria-setsize]")).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe: a virtualized search with the Archive and Trash section passes in ${colorScheme} mode (T056)`, async () => {
      const dataDir = freshDataDir();
      seedSearchSet(dataDir);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.emulateMedia({ colorScheme });
        await search(page, "notes about", { exactPhrase: true, includeArchiveTrash: true });
        await expect(page.locator("li.vspacer").first()).toBeAttached();
        await expectNoA11yViolations(page, `${colorScheme}: virtualized search`);
      } finally {
        await app.close();
      }
    });
  }
});

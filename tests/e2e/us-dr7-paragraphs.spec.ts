// 012 US7: details that read like the markdown (quickstart scenario 10, tasks T068).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
// One line of details text (13 px / 18 px since the HIG identity).
const GAP = 18;

const DOC = ["Plain paragraph", "# Heading", "- one\n- two", "> quoted", "| h |\n| - |\n| c |", "```\ncode\n```", "---", "Last paragraph"].join("\n\n");

/** The vertical gaps between consecutive top-level blocks of `root`. */
function gaps(root: Locator): Promise<number[]> {
  return root.evaluate((el) => {
    const blocks = Array.from(el.children).filter((c) => !c.classList.contains("fmenu") && getComputedStyle(c).display !== "none");
    const out: number[] = [];
    for (let i = 1; i < blocks.length; i++) {
      const a = (blocks[i - 1] as HTMLElement).getBoundingClientRect();
      const b = (blocks[i] as HTMLElement).getBoundingClientRect();
      out.push(b.top - a.bottom);
    }
    return out;
  });
}

async function launch(detailsMd: string, overrides: Parameters<typeof task>[0] = {}) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Reading", detailsMd, ...overrides });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  return { ...run, dataDir, id: a.id };
}

test.describe("012 US7 — details that read like the markdown", () => {
  test("FR-005a one line between any two top-level blocks while editing; none inside a list", async () => {
    const { app, page } = await launch(DOC);
    try {
      await card(page).locator(".title").click();
      const editor = details(page);
      await expect(editor.locator("table")).toBeVisible();
      for (const g of await gaps(editor)) expect(Math.abs(g - GAP)).toBeLessThanOrEqual(1);
      const items = editor.locator("li");
      const first = await items.nth(0).boundingBox();
      const second = await items.nth(1).boundingBox();
      expect((second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0))).toBeLessThan(GAP / 2);
    } finally {
      await app.close();
    }
  });

  test("FR-005a the same gaps in the read-only panel (Archive)", async () => {
    const { app, page } = await launch(DOC, { doneAt: Date.now() - 60_000 });
    try {
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.locator(".arow").filter({ hasText: "Reading" }).click();
      const body = page.locator(".ro-details");
      await expect(body.locator("table")).toBeVisible();
      for (const g of await gaps(body)) expect(Math.abs(g - GAP)).toBeLessThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  test("FR-005 Enter starts a paragraph one line below; Shift+Enter breaks the line with no gap; FR-005b an empty paragraph is not stored", async () => {
    const { app, page, dataDir, id } = await launch("first");
    try {
      await card(page).locator(".title").click();
      const editor = details(page);
      await editor.click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("second");
      await expect.poll(() => readTask(dataDir, id)?.details_md).toBe("first\n\nsecond");
      const [gap] = await gaps(editor);
      expect(Math.abs((gap ?? 0) - GAP)).toBeLessThanOrEqual(1);

      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type("third");
      await expect.poll(() => readTask(dataDir, id)?.details_md).toMatch(/^first\n\nsecond(\\| {2})\nthird$/);
      const lines = await editor.locator("p").nth(1).evaluate((p) => p.getClientRects().length);
      expect(lines).toBe(1);

      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("fourth");
      await expect.poll(() => readTask(dataDir, id)?.details_md).toMatch(/third\n\nfourth$/);
      await expect(menu(page)).toBeVisible();
    } finally {
      await app.close();
    }
  });
});

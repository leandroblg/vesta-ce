// 012 US6: delete a table and reach the row handle easily (quickstart scenario 9, tasks T064).
import { expect, test, type Page } from "@playwright/test";
import { readTask } from "./fixtures/clock";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const card = (page: Page) => page.locator("li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const TABLE = "| h1 | h2 |\n| -- | -- |\n| a1 | a2 |\n| b1 | b2 |";
const DOC = `before\n\n${TABLE}\n\nafter`;

async function launch(detailsMd: string) {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "Tables", detailsMd });
  seedTasks(dataDir, [a]);
  const run = await launchVesta({ dataDir });
  await card(run.page).locator(".title").click();
  return { ...run, dataDir, id: a.id };
}

const stored = (dataDir: string, id: string) => readTask(dataDir, id)?.details_md;

test.describe("012 US6 — tables", () => {
  for (const from of ["row handle", "column handle", "floating menu"] as const) {
    test(`FR-023 Delete table from the ${from} removes it in one step; one Undo brings it back`, async () => {
      const { app, page, dataDir, id } = await launch(DOC);
      try {
        const editor = details(page);
        const cell = editor.locator("td", { hasText: "a2" });
        await cell.click();
        if (from === "floating menu") {
          await menu(page).getByRole("button", { name: "Delete table" }).click();
        } else {
          await cell.hover();
          await page.locator(from === "row handle" ? ".tbl-h-row" : ".tbl-h-col").click();
          await page.locator(".tbl-menu button", { hasText: "Delete table" }).click();
        }
        await expect.poll(() => stored(dataDir, id)).toBe("before\n\nafter");
        await page.keyboard.press("ControlOrMeta+z");
        await expect.poll(() => stored(dataDir, id)).toMatch(/^before\n\n\| h1 \| h2 \|[\s\S]*\| b1 \| b2 \|\n\nafter$/);
      } finally {
        await app.close();
      }
    });
  }

  test("FR-024 the row handle sits at the right end of the hovered row; the column handle on the top edge", async () => {
    const { app, page } = await launch(DOC);
    try {
      const editor = details(page);
      const table = await editor.locator("table").boundingBox();
      for (const text of ["a1", "b2"]) {
        const cell = editor.locator("td", { hasText: text });
        await cell.hover();
        const row = await cell.boundingBox();
        const handle = await page.locator(".tbl-h-row").boundingBox();
        expect(handle, text).not.toBeNull();
        expect(Math.abs((handle?.x ?? 0) - ((table?.x ?? 0) + (table?.width ?? 0) + 2)), text).toBeLessThanOrEqual(2);
        const mid = (row?.y ?? 0) + (row?.height ?? 0) / 2;
        expect(Math.abs((handle?.y ?? 0) + (handle?.height ?? 0) / 2 - mid), text).toBeLessThanOrEqual(2);
      }
      const col = await page.locator(".tbl-h-col").boundingBox();
      expect((col?.y ?? 0) + (col?.height ?? 0)).toBeLessThanOrEqual((table?.y ?? 0) + 2);
    } finally {
      await app.close();
    }
  });

  test("FR-024 a table wider than the panel: the row handle stays inside the visible area", async () => {
    const wide = `| ${Array.from({ length: 30 }, (_, i) => `column${String(i)}`).join(" | ")} |\n| ${Array.from({ length: 30 }, () => "--").join(" | ")} |\n| ${Array.from({ length: 30 }, (_, i) => `cell${String(i)}`).join(" | ")} |`;
    const { app, page } = await launch(wide);
    try {
      const editor = details(page);
      const cell = editor.locator("td", { hasText: "cell0" });
      await cell.hover();
      const handle = await page.locator(".tbl-h-row").boundingBox();
      const area = await panel(page).boundingBox();
      expect((handle?.x ?? 0) + (handle?.width ?? 0)).toBeLessThanOrEqual((area?.x ?? 0) + (area?.width ?? 0));
      await expect(page.locator(".tbl-h-row")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("FR-025 Delete table by keyboard through the floating menu", async () => {
    const { app, page, dataDir, id } = await launch(DOC);
    try {
      await details(page).locator("td", { hasText: "b1" }).click();
      await menu(page).getByRole("button", { name: "Delete table" }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => stored(dataDir, id)).toBe("before\n\nafter");
      await expect(details(page)).toBeFocused();
    } finally {
      await app.close();
    }
  });
});

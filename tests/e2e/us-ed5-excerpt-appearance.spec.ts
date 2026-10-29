// 011 US5: tidier search results and Appearance settings (quickstart scenario 13, tasks T079).
import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { search } from "./fixtures/search";
import { seedTasks, task } from "./fixtures/seed";
import { dialog, openSettings } from "./fixtures/settings";

test.describe("011 US5 — excerpt and Appearance", () => {
  for (const width of [700, 1400]) {
    test(`FR-026 the details excerpt sits on its own line under the title, from its left edge (window ${String(width)} px)`, async () => {
      const dataDir = freshDataDir();
      seedTasks(dataDir, [
        task({ titleMd: "Short", detailsMd: "about the passport office", position: 1 }),
        task({ titleMd: `Long ${"title that wraps across the card ".repeat(6)}`, detailsMd: "bring the passport photos", position: 2 }),
      ]);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.setViewportSize({ width, height: 800 });
        await search(page, "passport");
        const cards = page.locator("li[data-kind='task']");
        await expect(cards).toHaveCount(2);
        for (const card of await cards.all()) {
          const title = await card.locator(".title").boundingBox();
          const excerpt = await card.locator(".search-excerpt").boundingBox();
          if (title === null || excerpt === null) throw new Error("not shown");
          expect(excerpt.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
          expect(Math.abs(excerpt.x - title.x)).toBeLessThanOrEqual(1);
        }
      } finally {
        await app.close();
      }
    });
  }

  test("FR-027 (Q165) Appearance offers Light, Dark and System as radio buttons, and Theme the four palettes", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "General");
      const section = dialog(page).locator("section.sset", { has: page.locator("#set-appearance-h") });
      await expect(section.getByRole("radio")).toHaveCount(3);
      await expect(section.getByRole("radio", { name: "System" })).toBeChecked();
      const palette = section.getByTestId("palette");
      await expect(palette.locator("option")).toHaveText(["Hearth", "System", "Ubuntu", "Minimalist"]);
      await palette.selectOption("ubuntu");
      await expect(page.locator("html")).toHaveAttribute("data-palette", "ubuntu");
      await palette.selectOption("hearth");
      await expect(page.locator("html")).not.toHaveAttribute("data-palette", /./);
    } finally {
      await app.close();
    }
  });
});

/** US5 — moving is off while a search filter is active (004 quickstart 19; FR-029, SC-006). */
import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readIndicator, readTitles } from "./fixtures/drag";

/** The FR-029 switch, through the unpackaged-only test hook (research §8). */
const setMovingDisabled = (page: Page, on: boolean) =>
  page.evaluate((value) => {
    window.__vestaTest?.setMovingDisabled(value);
  }, on);

async function setup() {
  const dataDir = freshDataDir();
  const p = task({ titleMd: "P", position: 3 });
  seedTasks(dataDir, [task({ titleMd: "A", position: 1 }), task({ titleMd: "B", position: 2 }), p, task({ titleMd: "S", parentId: p.id, position: 1 })]);
  return launchVesta({ dataDir });
}

const ORDER = ["A", "B", "P", "  S"];

test.describe("US5 — moving disabled", () => {
  test("no drag starts, the grip shows no grab affordance and no Alt key moves anything; turning it off restores both", async () => {
    const { app, page } = await setup();
    try {
      expect(await page.evaluate(() => typeof window.__vestaTest?.setMovingDisabled)).toBe("function");
      await setMovingDisabled(page, true);
      expect(await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" })).toBeNull();
      await expect(page.locator("li.dragging")).toHaveCount(0);
      expect(await readTitles(page)).toEqual(ORDER);
      await expect(taskCard(page, "A").locator(".grip")).toHaveCSS("cursor", "default");

      for (const [title, key] of [["B", "ArrowUp"], ["A", "ArrowDown"], ["S", "ArrowLeft"], ["B", "ArrowRight"]] as const) {
        await taskCard(page, title).getByRole("checkbox").focus();
        await page.keyboard.press(`Alt+${key}`);
      }
      await page.waitForTimeout(300);
      expect(await readTitles(page)).toEqual(ORDER);

      await setMovingDisabled(page, false);
      await expect(taskCard(page, "A").locator(".grip")).toHaveCSS("cursor", "grab");
      expect(await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" })).toBe("line-top");
      await expect.poll(() => readTitles(page)).toEqual(["B", "A", "P", "  S"]);
      await taskCard(page, "B").getByRole("checkbox").focus();
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(() => readTitles(page)).toEqual(ORDER);
    } finally {
      await app.close();
    }
  });

  test("turning it on during a drag cancels the drag", async () => {
    const { app, page } = await setup();
    try {
      expect(await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" }, { release: false })).toBe("line-top");
      await setMovingDisabled(page, true);
      await expect.poll(() => readIndicator(page)).toBeNull();
      await expect(page.locator("li.dragging")).toHaveCount(0);
      await page.mouse.up();
      expect(await readTitles(page)).toEqual(ORDER);
    } finally {
      await app.close();
    }
  });
});

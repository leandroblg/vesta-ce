import { expect, test, type Page } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";

const card = (page: Page, title: string) => page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });

async function openMenu(page: Page, title: string) {
  await clickRevealed(card(page, title), card(page, title).getByRole("button", { name: "More actions" }));
  return page.getByRole("menu");
}

async function addSubtask(page: Page, parent: string, title: string) {
  const menu = await openMenu(page, parent);
  await menu.getByRole("menuitem", { name: "New Subtask" }).click();
  const editor = page.getByRole("textbox", { name: "New subtask…" });
  await expect(editor).toBeFocused();
  await editor.fill(title);
  await editor.press("Enter");
}

test.describe("US3 — one level of subtasks", () => {
  test("Add subtask nests one level; the card stays ready; empty card goes away (scenarios 1–2)", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Prepare report", position: 1 }), task({ titleMd: "Fix bike", position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await addSubtask(page, "Prepare report", "Gather numbers");
      const editor = page.getByRole("textbox", { name: "New subtask…" });
      await expect(editor).toBeFocused();
      await editor.fill("Draft summary");
      await editor.press("Enter");
      await editor.press("Escape");
      await expect(editor).toHaveCount(0);

      const rows = page.locator("li[data-kind='task']");
      await expect(rows.locator(".title")).toHaveText(["Prepare report", "Gather numbers", "Draft summary", "Fix bike"]);
      await expect(card(page, "Gather numbers")).toHaveClass(/\bsub\b/);
      await expect(card(page, "Draft summary")).toHaveClass(/\bsub\b/);

      // Empty subtask card creates nothing and disappears.
      const menu = await openMenu(page, "Fix bike");
      await menu.getByRole("menuitem", { name: "New Subtask" }).click();
      await page.getByRole("textbox", { name: "New subtask…" }).press("Enter");
      await expect(page.getByRole("textbox", { name: "New subtask…" })).toHaveCount(0);
      await expect(rows).toHaveCount(4);
    } finally {
      await app.close();
    }
  });

  test("a subtask's menu offers Details but not Add subtask; Esc and click outside close it (scenario 3)", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent" });
    seedTasks(dataDir, [parent, task({ titleMd: "Child", parentId: parent.id })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      let menu = await openMenu(page, "Child");
      await expect(menu.getByRole("menuitem", { name: "Show Details" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "New Subtask" })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);

      menu = await openMenu(page, "Parent");
      await expect(menu.getByRole("menuitem", { name: "New Subtask" })).toBeVisible();
      await menu.getByRole("menuitem", { name: "Show Details" }).click(); // inert (FR-010)
      await expect(menu).toHaveCount(0);
      menu = await openMenu(page, "Parent");
      await page.locator("header").click();
      await expect(menu).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("collapse toggle only on parents; collapse hides subtasks; state survives a relaunch (scenarios 4–6)", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent", position: 1 });
    seedTasks(dataDir, [parent, task({ titleMd: "Child", parentId: parent.id }), task({ titleMd: "Lonely", position: 2 })]);
    let run = await launchVesta({ dataDir });
    const toggle = (p: Page) => card(p, "Parent").getByRole("button", { name: /Collapse|Expand/ });
    await expect(card(run.page, "Lonely").getByRole("button", { name: /Collapse|Expand/ })).toHaveCount(0);
    await expect(toggle(run.page)).toHaveAttribute("aria-expanded", "true");
    await toggle(run.page).click();
    await expect(card(run.page, "Child")).toHaveCount(0);
    await expect(toggle(run.page)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(run.page)).toHaveAccessibleName("Expand");

    run = await relaunch(run);
    try {
      await expect(toggle(run.page)).toHaveAttribute("aria-expanded", "false");
      await expect(card(run.page, "Child")).toHaveCount(0);
      // Adding a subtask expands the parent (FR-014).
      await addSubtask(run.page, "Parent", "Second child");
      await expect(card(run.page, "Child")).toBeVisible();
      await expect(toggle(run.page)).toHaveAttribute("aria-expanded", "true");
    } finally {
      await run.app.close();
    }
  });
});

import { expect, test, type Page } from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures/axe";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task, writeLatestJson } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";

const card = (page: Page, title: string) =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const titles = (page: Page) => page.locator("li[data-kind='task'] .title");

function seedShell(dataDir: string) {
  const parent = task({ titleMd: "Prepare quarterly report", position: 1 });
  const collapsed = task({ titleMd: "Plan trip", position: 2, collapsed: true });
  seedTasks(dataDir, [
    parent,
    task({ titleMd: "Gather sales numbers", parentId: parent.id, position: 1 }),
    task({ titleMd: "Draft summary, a long title that wraps onto a second line when the window is narrow enough to need it", parentId: parent.id, position: 2 }),
    collapsed,
    task({ titleMd: "Book flights", parentId: collapsed.id }),
    task({ titleMd: "Fix bike", position: 3 }),
    task({ titleMd: "Old done", position: 4, doneAt: Date.now() - 5000 }),
    task({ titleMd: "Old trash", position: 5, deletedAt: Date.now() - 5000 }),
  ]);
}

test.describe("US7 — app shell and card layout", () => {
  test("header order; Settings opens the Settings dialog (1, 2; 006 FR-001 and 007 FR-001 replace the inert controls)", async () => {
    const dataDir = freshDataDir();
    seedShell(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const header = page.locator("header");
      const search = header.getByRole("searchbox", { name: "Search tasks and reminders" });
      await expect(search).toHaveAttribute("placeholder", "Search tasks and reminders");
      // 013 FR-032 (PRD Q166, Q167): no New task and no Settings button; the scope bar has "Search in:" options.
      await expect(header.getByRole("button", { name: /^Settings/ })).toHaveCount(0);
      const order = await header.locator("input[type='search'], input[type='checkbox'], button").evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") ?? e.closest("label")?.textContent ?? e.textContent.replace(/\d+/g, "").trim()),
      );
      expect(order).toEqual(["Search tasks and reminders", "Search options", "Active", "Everything", "Match case", "Exact phrase", "Archive", "Trash"]);

      const before = await titles(page).allTextContents();
      await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+Comma`);
      expect(await titles(page).allTextContents()).toEqual(before);
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("card order, hover and focus buttons, single click opens the details panel, and drag handle (3–6)", async () => {
    const dataDir = freshDataDir();
    seedShell(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const parentCard = card(page, "Prepare quarterly report");
      const parts = await parentCard.evaluate((li) =>
        [...li.children].map((c) => (c as HTMLElement).className || c.tagName.toLowerCase()),
      );
      expect(parts.slice(0, 3)).toEqual(["cb", "twisty", "title-wrap"]);
      // 014 FR-001: the buttons and the drag handle sit in the reserved zone, the buttons' stack before the handle.
      expect(parts.at(-1)).toBe("zone");
      const zone = await parentCard.locator(".zone").evaluate((z) => [...z.children].map((c) => (c as HTMLElement).className));
      expect(zone[0]).toBe("zone-stack");
      expect(zone[1]).toMatch(/^grip/);
      await expect(parentCard.locator(".zone-stack > .actions")).toHaveCount(1);

      const actions = parentCard.locator(".actions");
      await page.mouse.move(0, 0);
      await expect(actions).toHaveCSS("opacity", "0");
      await parentCard.hover();
      await expect(actions).toHaveCSS("opacity", "1");
      await page.mouse.move(0, 0);
      await parentCard.getByRole("button", { name: "Edit" }).focus();
      await expect(actions).toHaveCSS("opacity", "1");
      const names = await actions.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
      expect(names).toEqual(["Edit", "More actions"]);

      const before = await titles(page).allTextContents();
      // 005 FR-001 replaces 001 FR-010's inert single click: it opens the details panel, and no inline editor.
      await parentCard.locator(".title").click();
      await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
      await expect(page.locator(".inline-edit [role='textbox']")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("complementary", { name: "Details" })).toHaveCount(0);
      // 001 FR-010 kept the drag handle inert until feature 004; it now starts a drag (004 FR-001,
      // covered in us-dnd1-reorder.spec.ts). Esc cancels this one, so the order is unchanged.
      const grip = await parentCard.locator(".grip").boundingBox();
      if (grip === null) throw new Error("no grip");
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 30, { steps: 4 });
      await expect(parentCard).toHaveClass(/dragging/);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(await titles(page).allTextContents()).toEqual(before);

      const longCard = card(page, "Draft summary, a long title that wraps onto a second line when the window is narrow enough to need it");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(480, 700));
      await expect.poll(async () => (await longCard.boundingBox())?.height ?? 0).toBeGreaterThan(50);
    } finally {
      await app.close();
    }
  });

  test("every control is reachable by keyboard and named (FR-044, SC-009)", async () => {
    const dataDir = freshDataDir();
    seedShell(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const reached: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const name = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (el === null || el === document.body) return "";
          return el.getAttribute("aria-label") ?? el.textContent.trim();
        });
        if (name !== "") reached.push(name);
      }
      // 013 FR-023: Settings is in the menu bar, not the toolbar.
      for (const expected of ["Search tasks and reminders", "Mark done: Fix bike", "Collapse", "Expand", "Edit", "More actions"]) {
        expect(reached.some((r) => r.startsWith(expected))).toBe(true);
      }

      // Context menu fully by keyboard: open with Enter, move with arrows, Esc returns focus.
      await card(page, "Fix bike").getByRole("button", { name: "More actions" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menuitem", { name: "New Subtask" })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitem", { name: "Show Details" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(card(page, "Fix bike").getByRole("button", { name: "More actions" })).toBeFocused();
    } finally {
      await app.close();
    }
  });

  for (const colorScheme of ["light", "dark"] as const) {
    test(`no accessibility violations in ${colorScheme} mode (SC-009, FR-045)`, async () => {
      test.setTimeout(90_000);
      const dataDir = freshDataDir();
      seedShell(dataDir);
      writeLatestJson(dataDir, Date.now() - 31 * 60_000);
      const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "backup" } });
      try {
        await page.emulateMedia({ colorScheme });
        // Info notice (backup failed) is visible at launch.
        await expect(page.getByTestId("notification")).toHaveAttribute("data-kind", "backupFailed");
        await expectNoA11yViolations(page, `${colorScheme}: main view + info notice`);
        await clickRevealed(page.getByTestId("notification"), page.getByTestId("notification").getByRole("button", { name: "Close" }));

        await clickRevealed(card(page, "Fix bike"), card(page, "Fix bike").getByRole("button", { name: "More actions" }));
        await expectNoA11yViolations(page, `${colorScheme}: open context menu`);
        await page.keyboard.press("Escape");

        await card(page, "Fix bike").locator(".title").dblclick();
        await expectNoA11yViolations(page, `${colorScheme}: inline editor`);
        await page.keyboard.press("Escape");

        await card(page, "Fix bike").getByRole("checkbox").click();
        await expect(page.getByTestId("notification")).toHaveAttribute("data-kind", "done");
        await expectNoA11yViolations(page, `${colorScheme}: undo notice`);

        await page.getByRole("button", { name: /^Archive/ }).click();
        await expectNoA11yViolations(page, `${colorScheme}: Archive`);
        await page.getByRole("button", { name: /^Trash/ }).click();
        await page.getByRole("button", { name: /Delete permanently/ }).first().click();
        await expectNoA11yViolations(page, `${colorScheme}: Trash`);
      } finally {
        await app.close();
      }
    });
  }

  test("sticky notice passes the scan in both themes (SC-009)", async () => {
    const dataDir = freshDataDir();
    seedShell(dataDir);
    const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "save" } });
    try {
      await card(page, "Fix bike").getByRole("checkbox").click();
      await expect(page.getByTestId("notification")).toHaveAttribute("data-kind", "saveFailed");
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await expectNoA11yViolations(page, `${colorScheme}: sticky notice`);
      }
    } finally {
      await app.close();
    }
  });

  test("reduced motion: no running animations or transitions (FR-045)", async () => {
    const dataDir = freshDataDir();
    seedShell(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await card(page, "Prepare quarterly report").getByRole("button", { name: "Collapse" }).click();
      await card(page, "Fix bike").getByRole("checkbox").click();
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    } finally {
      await app.close();
    }
  });
});

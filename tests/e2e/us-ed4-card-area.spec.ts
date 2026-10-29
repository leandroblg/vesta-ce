// 011 US4: a click anywhere on the card's text area opens it (quickstart scenarios 12 and 12b, tasks T071).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { search } from "./fixtures/search";
import { reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const cardOf = (page: Page, title: string) => page.locator("main li[data-id]", { has: page.locator(".title", { hasText: title }) }).first();
/** A card by id: stays found while its title is being edited (the editor replaces `.title`). */
const cardById = (page: Page, id: string) => page.locator(`main li[data-id="${id}"]`);

type Point = [name: string, at: (card: Locator) => Promise<{ x: number; y: number }>];

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (b === null) throw new Error("not shown");
  return b;
}

/** The SC-006 sample points that every card kind has. */
const POINTS: Point[] = [
  ["just after the checkbox or arrow", async (card) => {
    const before = card.locator(":scope > .twisty, :scope > .twisty-sp, :scope > .cb").last();
    const b = await box(before);
    return { x: b.x + b.width + 3, y: b.y + b.height / 2 };
  }],
  ["the empty space after the title", async (card) => {
    const t = await box(card.locator(".title"));
    const c = await box(card);
    return { x: t.x + t.width + (c.x + c.width - 60 - (t.x + t.width)) / 2, y: c.y + c.height - 6 };
  }],
  ["just left of the grip", async (card) => {
    const g = await box(card.locator(".grip"));
    const c = await box(card);
    return { x: g.x - 4, y: c.y + c.height - 4 };
  }],
  ["the top padding", async (card) => {
    const t = await box(card.locator(".title"));
    const c = await box(card);
    return { x: t.x + 4, y: c.y + 2 };
  }],
  ["the bottom padding", async (card) => {
    const t = await box(card.locator(".title"));
    const c = await box(card);
    return { x: t.x + 4, y: c.y + c.height - 2 };
  }],
];

async function clickAt(page: Page, p: { x: number; y: number }) {
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

test.describe("011 US4 — the card click area", () => {
  test("FR-022 FR-022a SC-006 a single click anywhere in the area opens the panel, on every task card kind; tags count", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent" });
    const sub = staleTask({ titleMd: "Child", parentId: parent.id });
    // A title that wraps puts the age label on its last line, below the hover buttons (FR-023).
    const lone = staleTask({ titleMd: `Lone ${"and a long title that wraps onto another line ".repeat(3)}` });
    seedTasks(dataDir, [lone, parent, sub]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      for (const title of ["Lone", "Parent", "Child"]) {
        const card = cardOf(page, title);
        const points = [...POINTS];
        if (title === "Lone") points.push(["on the age label", async (c) => {
          const b = await box(c.locator(".age"));
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }]);
        if (title === "Parent") points.push(["on the stale-subtask indicator", async (c) => {
          const b = await box(c.locator(".stale-sub"));
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }]);
        for (const [name, at] of points) {
          await clickAt(page, await at(card));
          await expect(panel(page), `${title}: ${name}`).toContainText(title);
          await page.keyboard.press("Escape");
          await expect(panel(page)).toHaveCount(0);
        }
      }
    } finally {
      await app.close();
    }
  });

  test("FR-022 a double click in the area edits without opening the panel; FR-025 the checkbox, buttons and grip keep their behavior", async () => {
    const dataDir = freshDataDir();
    const short = task({ titleMd: "Short" });
    seedTasks(dataDir, [short]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const card = cardById(page, short.id);
      const t = await box(card.locator(".title"));
      const c = await box(card);
      await page.mouse.dblclick(t.x + t.width + 40, c.y + c.height - 6);
      await expect(card.locator(".ProseMirror")).toBeFocused();
      await expect(panel(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await card.hover();
      await card.getByRole("button", { name: "More" }).click();
      await expect(page.locator(".menu")).toBeVisible();
      await expect(panel(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
    } finally {
      await app.close();
    }
  });

  test("FR-022 a reminder: a double click in the area edits; a single click opens nothing and closes an open panel", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Task" })]);
    const call = reminder({ textMd: "Call" });
    seedReminders(dataDir, [call]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await cardOf(page, "Task").locator(".title").click();
      await expect(panel(page)).toBeVisible();
      const rem = cardById(page, call.id);
      const t = await box(rem.locator(".title"));
      const c = await box(rem);
      // 014 FR-001: right of the text inside the title column; the zone after it holds the hover buttons (Q197).
      await page.mouse.click(t.x + t.width - 10, c.y + c.height - 6);
      await expect(panel(page)).toHaveCount(0);
      await page.mouse.dblclick(t.x + t.width - 10, c.y + c.height - 6);
      await expect(rem.locator(".ProseMirror")).toBeFocused();
    } finally {
      await app.close();
    }
  });

  test("FR-024 a press moved 4 px drags and opens nothing; during a search it opens nothing either; the left padding switches at once", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Alpha one", position: 1 }), task({ titleMd: "Beta two", position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const a = cardOf(page, "Alpha");
      const t = await box(a.locator(".title"));
      const c = await box(a);
      const start = { x: t.x + t.width + 30, y: c.y + c.height - 6 };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x, start.y + 12, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await expect(panel(page)).toHaveCount(0);

      await search(page, "one two");
      await search(page, "Alpha");
      const s = await box(cardOf(page, "Alpha"));
      await page.mouse.move(s.x + s.width / 2, s.y + s.height - 6);
      await page.mouse.down();
      await page.mouse.move(s.x + s.width / 2 + 10, s.y + s.height - 6, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      await expect(panel(page)).toHaveCount(0);
      await page.getByRole("button", { name: "Clear search" }).click();

      await cardOf(page, "Alpha").locator(".title").click();
      await expect(panel(page)).toContainText("Alpha");
      await cardOf(page, "Beta").click({ position: { x: 3, y: 3 } });
      await expect(panel(page)).toContainText("Beta");
    } finally {
      await app.close();
    }
  });

  test("FR-022 SC-006 the search excerpt's whole line is part of the area", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Trip", detailsMd: "remember the passport renewal" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "passport");
      const card = cardOf(page, "Trip");
      const ex = await box(card.locator(".search-excerpt"));
      const c = await box(card);
      await clickAt(page, { x: ex.x + 4, y: ex.y + ex.height / 2 });
      await expect(panel(page)).toContainText("Trip");
      await page.keyboard.press("Escape");
      await clickAt(page, { x: c.x + c.width - 50, y: ex.y + ex.height / 2 });
      await expect(panel(page)).toContainText("Trip");
    } finally {
      await app.close();
    }
  });

  test("FR-022b the Archive and the Trash open the panel read-only on a click or Enter; Shift+Enter restores", async () => {
    const dataDir = freshDataDir();
    const now = Date.now();
    seedTasks(dataDir, [task({ titleMd: "Finished", detailsMd: "notes **here**", doneAt: now - 1000 }), task({ titleMd: "Binned", deletedAt: now - 1000 })]);
    seedReminders(dataDir, [reminder({ textMd: "Old call", doneAt: now - 500 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.getByRole("button", { name: /Archive/ }).first().click();
      const row = cardOf(page, "Finished");
      const r = await box(row);
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      await expect(panel(page)).toHaveAttribute("data-readonly", "");
      await expect(panel(page)).toContainText("notes here");
      await expect(panel(page).locator(".ProseMirror")).toHaveCount(0);
      await expect(panel(page).getByRole("button", { name: "Reschedule" })).toHaveCount(0);
      await expect(panel(page).locator(".ov-set")).toHaveCount(0);
      // The open panel narrows the row, so its middle may now be under Restore or Delete: aim at the title.
      const title = await box(row.locator(".title"));
      await page.mouse.dblclick(title.x + 10, title.y + title.height / 2);
      await expect(panel(page)).toHaveAttribute("data-readonly", "");
      await expect(row.locator(".ProseMirror")).toHaveCount(0);
      const rem = await box(cardOf(page, "Old call").locator(".title"));
      await page.mouse.click(rem.x + 10, rem.y + rem.height / 2);
      await expect(panel(page)).toHaveCount(0);

      await row.focus();
      await page.keyboard.press("Enter");
      await expect(panel(page)).toHaveAttribute("data-readonly", "");
      await page.keyboard.press("Escape");
      await cardOf(page, "Old call").focus();
      await page.keyboard.press("Enter");
      await expect(panel(page)).toHaveCount(0);
      await row.focus();
      await page.keyboard.press("Shift+Enter");
      await expect(page.locator("main")).not.toContainText("Finished");

      await page.getByRole("button", { name: /Trash/ }).first().click();
      const binned = cardOf(page, "Binned");
      await binned.click({ position: { x: 20, y: 10 } });
      await expect(panel(page)).toHaveAttribute("data-readonly", "");
      await expect(panel(page)).toContainText("Deleted");
    } finally {
      await app.close();
    }
  });
});

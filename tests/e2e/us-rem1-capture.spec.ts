import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import {
  addReminder,
  newReminderEditor,
  reminderCards,
  reminderList,
  reminderSection,
  reminderTexts,
  reminderToggle,
} from "./fixtures/reminders";
import { DAY, reminder, seedReminders } from "./fixtures/seed";

test.describe("002 US1 — keep short notes in sight above the tasks", () => {
  test("section above Tasks with heading, count and toggle; empty prompt; Enter adds within 5 s (1, 2, 4, SC-001)", async () => {
    const { app, page } = await launchVesta();
    try {
      const section = reminderSection(page);
      await expect(section.getByRole("heading", { name: /Reminders/ })).toBeVisible();
      await expect(reminderToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(section.locator(".count")).toHaveText("0");
      const remBox = await section.boundingBox();
      const taskBox = await page.locator("section[aria-labelledby='tasks-h']").boundingBox();
      expect(remBox && taskBox && remBox.y + remBox.height <= taskBox.y).toBe(true);

      await expect(reminderList(page).getByRole("listitem")).toHaveCount(2);
      const prompt = section.getByTestId("empty-reminders");
      await expect(prompt).toBeVisible();

      const started = performance.now();
      await section.getByRole("button", { name: "New reminder…" }).click();
      await newReminderEditor(page).fill("Pick up dry cleaning");
      await newReminderEditor(page).press("Enter");
      await expect(reminderCards(page)).toHaveCount(1);
      expect(performance.now() - started).toBeLessThan(5_000); // SC-001

      expect(await reminderTexts(page)).toEqual(["Pick up dry cleaning"]);
      await expect(newReminderEditor(page)).toBeFocused();
      await expect(newReminderEditor(page)).toHaveText("");
      await expect(section.locator(".count")).toHaveText("1");
    } finally {
      await app.close();
    }
  });

  test("the empty card shows the placeholder once reminders exist (3)", async () => {
    const { app, page } = await launchVesta();
    try {
      await addReminder(page, "First");
      await newReminderEditor(page).press("Escape");
      await expect(reminderSection(page).getByRole("button", { name: "New reminder…" })).toBeVisible();
    } finally {
      await app.close();
    }
  });

  test("empty or whitespace text creates nothing on Enter, Esc or click outside; Esc discards typed text (5)", async () => {
    const { app, page } = await launchVesta();
    try {
      const open = () => reminderSection(page).getByRole("button", { name: "New reminder…" }).click();
      const editor = newReminderEditor(page);
      await open();
      await editor.fill("   ");
      await editor.press("Enter");
      await expect(reminderCards(page)).toHaveCount(0);

      await open();
      await editor.press("Escape");
      await expect(reminderCards(page)).toHaveCount(0);

      await open();
      await editor.fill("  ");
      await page.locator("header").click();
      await expect(reminderCards(page)).toHaveCount(0);

      await open();
      await editor.fill("Typed then discarded");
      await editor.press("Escape");
      await expect(reminderCards(page)).toHaveCount(0);
      await open();
      await expect(editor).toHaveText("");
    } finally {
      await app.close();
    }
  });

  test("reminders survive a relaunch in the same order (6)", async () => {
    let run = await launchVesta();
    for (const t of ["One", "Two", "Three"]) await addReminder(run.page, t);
    run = await relaunch(run);
    try {
      expect(await reminderTexts(run.page)).toEqual(["One", "Two", "Three"]);
    } finally {
      await run.app.close();
    }
  });

  test("card order is checkbox, text, drag handle; long text wraps and the card grows (7)", async () => {
    const dataDir = freshDataDir();
    const long = "A long reminder ".repeat(30).trim();
    seedReminders(dataDir, [reminder({ textMd: "Short" }), reminder({ textMd: long })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const card = reminderCards(page).first();
      const order = await card.evaluate((li) =>
        Array.from(li.children).map((el) => (el.matches("input[type=checkbox]") ? "checkbox" : el.className.split(" ")[0])),
      );
      // 014 FR-001: the drag handle sits last in the reserved zone, after the buttons' stack.
      expect(order.filter((c) => ["checkbox", "title-wrap", "zone"].includes(c ?? ""))).toEqual(["checkbox", "title-wrap", "zone"]);
      expect(await card.locator(".zone").evaluate((z) => (z.lastElementChild as HTMLElement).className.split(" ")[0])).toBe("grip");
      await expect(card.getByRole("checkbox", { name: "Mark done: Short" })).toBeVisible();
      const short = await reminderCards(page).nth(0).boundingBox();
      const tall = await reminderCards(page).nth(1).boundingBox();
      expect((tall?.height ?? 0) > (short?.height ?? 0) * 1.5).toBe(true);
      expect(await reminderCards(page).nth(1).locator(".title").textContent()).toBe(long);
    } finally {
      await app.close();
    }
  });

  test("with 200 active reminders the empty card becomes 'Maximum reminders reached' and cannot be typed into (8, FR-007a)", async () => {
    const dataDir = freshDataDir();
    seedReminders(dataDir, Array.from({ length: 200 }, (_, i) => reminder({ textMd: `R${String(i)}`, position: i + 1 })));
    const { app, page } = await launchVesta({ dataDir });
    try {
      await expect(reminderCards(page)).toHaveCount(200);
      const max = reminderList(page).locator("li.max");
      await expect(max).toHaveText("Maximum reminders reached");
      await expect(max.getByRole("button")).toHaveCount(0);
      await expect(max.getByRole("textbox")).toHaveCount(0);
      await expect(reminderSection(page).getByRole("button", { name: "New reminder…" })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test("a reminder 30 days old shows no age, stale highlight or blink (9, SC-008)", async () => {
    const dataDir = freshDataDir();
    const old = Date.now() - 30 * DAY;
    seedReminders(dataDir, [reminder({ textMd: "Old", createdAt: old, updatedAt: old })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const card = reminderCards(page).first();
      await expect(card).toBeVisible();
      expect(await card.getAttribute("class")).not.toMatch(/stale|blink/);
      await expect(card.locator(".age")).toHaveCount(0);
      expect(await card.evaluate((el) => el.getAnimations().length)).toBe(0);
    } finally {
      await app.close();
    }
  });
});

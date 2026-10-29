// 011 US6: on a Mac, the key is called Return (quickstart scenario 14, tasks T083). Runs on the host OS.
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test } from "@playwright/test";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { IS_MAC, dialog, openSettings } from "./fixtures/settings";

const word = IS_MAC ? "Return" : "Enter";

function storedShortcuts(dataDir: string): string | undefined {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    return (db.prepare("select value from settings where key = 'shortcuts'").get() as { value: string } | undefined)?.value;
  } finally {
    db.close();
  }
}

test.describe("011 US6 — the Enter key's name", () => {
  test(`FR-031 FR-032 the edit hint, the link box and the Settings shortcut list say ${word}`, async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Name" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const card = page.locator("li[data-kind='task']").first();
      await card.locator(".title").dblclick();
      await expect(card.locator(".edit-hint")).toHaveText(`${word} to save · Esc to cancel`);
      // 016 FR-013: Link opens the link panel (labelled fields, no key hint); Esc closes it, then the edit.
      await menu(page).getByRole("button", { name: "Link" }).click();
      await expect(menu(page).locator(".fm-linkpanel")).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      const before = storedShortcuts(dataDir);
      await openSettings(page, "Shortcuts");
      const done = dialog(page).locator("tr[data-action='done'] kbd").first();
      const open = dialog(page).locator("tr[data-action='open'] kbd").first();
      if (IS_MAC) {
        await expect(done).toHaveText("⌘↩");
        await expect(done).toHaveAttribute("aria-label", "Command Return");
        await expect(open).toHaveText("↩");
        await expect(open).toHaveAttribute("aria-label", "Return");
      } else {
        await expect(done).toHaveText("Ctrl+Enter");
        await expect(done).toHaveAttribute("aria-label", "Control Enter");
        await expect(open).toHaveText("Enter");
      }
      // FR-033: only the shown and spoken names change.
      expect(storedShortcuts(dataDir)).toBe(before);
    } finally {
      await app.close();
    }
  });
});

import { expect, test } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";

test("the built app opens a secured window with the contract API only", async () => {
  const { app, page } = await launchVesta();
  try {
    await expect(page).toHaveTitle("Vesta");
    const api = await page.evaluate(() => ({
      groups: Object.keys(window.vesta).sort(),
      tasks: Object.keys(window.vesta.tasks).sort(),
      hasRequire: typeof (window as unknown as { require?: unknown }).require !== "undefined",
      hasProcess: typeof (window as unknown as { process?: unknown }).process !== "undefined",
    }));
    expect(api.groups).toEqual(["alerts", "app", "assets", "cleanup", "clipboard", "data", "dialog", "keys", "logs", "menu", "on", "reminders", "search", "settings", "tasks", "undo", "updates", "window"]);
    expect(api.tasks).toEqual([
      "create",
      "delete",
      "deletePermanently",
      "editDetails",
      "editTitle",
      // 015 contracts/ipc.md: a task's history for the details panel.
      "history",
      "markDone",
      "move",
      "reschedule",
      "restore",
      "setAlertOverride",
      "setCollapsed",
    ]);
    expect(api.hasRequire).toBe(false);
    expect(api.hasProcess).toBe(false);
  } finally {
    await app.close();
  }
});

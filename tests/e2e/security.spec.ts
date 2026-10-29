import { expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDamaged } from "../unit/fixtures/damage";
import { exportVia, importVia } from "./fixtures/export";
import { launchVesta } from "./fixtures/launch";
import { backToTasks } from "./fixtures/nav";

test.describe("renderer security (constitution I and II)", () => {
  test("no Node in the renderer; only the contract on window.vesta", async () => {
    const { app, page } = await launchVesta();
    try {
      const probe = await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        return {
          require: typeof w["require"],
          process: typeof w["process"],
          ipcRenderer: typeof w["ipcRenderer"],
          api: Object.fromEntries(
            Object.entries(window.vesta).map(([k, v]) => [k, typeof v === "function" ? "fn" : Object.keys(v as object).sort()]),
          ),
        };
      });
      expect(probe.require).toBe("undefined");
      expect(probe.process).toBe("undefined");
      expect(probe.ipcRenderer).toBe("undefined");
      expect(probe.api).toEqual({
        alerts: ["tick"],
        // 013 contracts/ipc.md: the Help menu's two fixed pages, the menu state and the Delete Permanently… dialog.
        app: ["flushDone", "getInitialState", "logError", "openExternal", "openHelp"],
        // 016 contracts/ipc.md: reveal a stored file; the clipboard is written in main.
        assets: ["importBytes", "importPath", "open", "pick", "reveal"],
        clipboard: ["write"],
        // 008 contracts/ipc.md: export and import; no channel takes or returns a path.
        data: ["endUndoOffer", "export", "import", "undoImport"],
        // 018 contracts/ipc.md: the cleanup times and their countdowns.
        cleanup: ["status"],
        // 011 contracts/ipc.md: pinned and recent colors, and the rows-first table setting; 018 the cleanups.
        settings: ["setAlert", "setAutoUpdateCheck", "setCleanup", "setColorLists", "setLanguage", "setLastTextColor", "setLogLevel", "setPalette", "setPanelWidth", "setShortcuts", "setTableRowsFirst", "setTheme", "setUpdateReminder", "setUpdateReminderDays"],
        // 009 contracts/ipc.md: logs are read in pages by file name; update links are opened by main.
        logs: ["read", "watch"],
        updates: ["check", "open", "paneShown"],
        menu: ["setState"],
        dialog: ["confirmDeleteForever"],
        window: ["minimize"],
        keys: ["setCapture"],
        search: ["query"],
        reminders: ["create", "delete", "deletePermanently", "editText", "markDone", "move", "restore", "setCollapsed"],
        tasks: [
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
        ],
        // 016 FR-004: the redo of an undone reschedule.
        undo: ["apply", "redo"],
        on: "fn",
      });
      const frozen = await page.evaluate(() => Object.isFrozen(window.vesta));
      expect(frozen).toBe(true);
      await expect(page.evaluate(() => window.vesta.on("not-an-event" as never, () => undefined))).rejects.toThrow();
    } finally {
      await app.close();
    }
  });

  test("window.open is denied, navigation is blocked, notifications are refused (FR-030)", async () => {
    const { app, page } = await launchVesta();
    try {
      expect(await page.evaluate(() => window.open("https://example.com") === null)).toBe(true);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      const before = page.url();
      await page.evaluate(() => {
        window.location.href = "https://example.com/";
      });
      await page.waitForTimeout(300);
      expect(page.url()).toBe(before);
      expect(await page.evaluate(() => Notification.permission)).toBe("denied");
      expect(await app.evaluate(({ session }) => session.defaultSession.isSpellCheckerEnabled())).toBe(false);
    } finally {
      await app.close();
    }
  });

  test("no request leaves the app during the US1–US5 flows (SC-010)", async () => {
    const { app, page } = await launchVesta();
    const requests: string[] = [];
    page.on("request", (r) => {
      // 010 L13: the page and its stored files load from Vesta's own schemes, which are not network requests.
      if (!/^(?:file|app|vesta-asset):/.test(r.url())) requests.push(r.url());
    });
    try {
      await page.getByRole("button", { name: "New task…" }).click();
      const editor = page.getByRole("textbox", { name: "New task…" });
      await editor.fill("One");
      await editor.press("Enter");
      await editor.fill("Two");
      await editor.press("Enter");
      await editor.press("Escape");
      const one = page.locator("li[data-kind='task']").filter({ hasText: "One" });
      await one.locator(".title").dblclick();
      await page.locator("li[data-kind='task'] [role='textbox']").fill("One edited");
      await page.locator("li[data-kind='task'] [role='textbox']").press("Enter");
      await page.locator("li[data-kind='task']").filter({ hasText: "One edited" }).getByRole("checkbox").click();
      await page.getByRole("button", { name: /^Archive/ }).click();
      await page.getByRole("button", { name: "Restore: One edited" }).click();
      await page.getByRole("button", { name: /^Trash/ }).click();
      await backToTasks(page);
      expect(requests).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("008 FR-051: export with logs and import with images make no network request and write only where they should", async () => {
    const root = mkdtempSync(join(tmpdir(), "vesta-fr051-"));
    const outFolder = join(root, "out");
    const inFolder = join(root, "in");
    mkdirSync(outFolder);
    mkdirSync(inFolder);
    const zip = join(inFolder, "export.zip");
    writeDamaged(zip, "valid");
    const { app, page } = await launchVesta();
    const requests: string[] = [];
    page.on("request", (r) => {
      if (/^(?:https?|wss?):/i.test(r.url())) requests.push(r.url());
    });
    try {
      await exportVia(app, page, outFolder, { includeLogs: true });
      expect(await importVia(app, page, zip)).toBe("merged");
      await expect(page.locator("li[data-kind='task']").filter({ hasText: "From the export" })).toBeVisible();
      expect(requests).toEqual([]);
      expect(readdirSync(root).sort()).toEqual(["in", "out"]);
      expect(readdirSync(inFolder)).toEqual(["export.zip"]);
      expect(readdirSync(outFolder)).toHaveLength(1);
      expect(readdirSync(outFolder)[0]).toMatch(/^vesta-export-\d{4}-\d{2}-\d{2}\.zip$/);
    } finally {
      await app.close();
    }
  });
});

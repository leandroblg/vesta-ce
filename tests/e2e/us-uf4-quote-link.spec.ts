/**
 * 016 User Story 3 (link part): the link panel, the link context menu, Copy Link and links whose address is not safe
 * (FR-013 to FR-017, FR-016a to FR-016c; PRD Q233, Q234, Q241, Q245, Q251, Q255, Q257; ui.md "Link panel" and "Link
 * context menu"). The Quote and Divider part is US6's.
 */
import { createHash } from "node:crypto";
import { expect, test, type ElectronApplication, type Locator, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, readTask } from "./fixtures/clock";
import { caretAtEnd, menu, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { clickMenu, waitMenuState } from "./fixtures/menu";
import { reminderCard } from "./fixtures/reminders";
import { elsewhereSection, search } from "./fixtures/search";
import { addTasks, reminder, seedAsset, seedReminders, seedTasks, task } from "./fixtures/seed";

const mod = process.platform === "darwin" ? "Meta" : "Control";
const REVEAL = process.platform === "darwin" ? "Show in Finder" : process.platform === "win32" ? "Show in File Explorer" : "Show in Folder";
const UNSAFE = "This link's address is not safe, so it will not be opened.";
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const PDF_REF = `assets/${createHash("sha256").update(PDF).digest("hex")}.pdf`;

const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const details = (page: Page) => panel(page).getByRole("textbox", { name: "Details" });
const linkMenu = (page: Page) => page.getByRole("menu", { name: "Link" });
const linkPanel = (page: Page) => page.locator(".fmenu .fm-linkpanel:visible");
const field = (page: Page, name: "link-text" | "link-href") => linkPanel(page).locator(`input[name="${name}"]`);
const notice = (page: Page) => page.getByTestId("notification");

async function stubShell(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { shellCalls: string[] };
    g.shellCalls = [];
    shell.openPath = (p: string) => {
      g.shellCalls.push(`openPath ${p}`);
      return Promise.resolve("");
    };
    shell.showItemInFolder = (p: string) => {
      g.shellCalls.push(`show ${p}`);
    };
    shell.openExternal = (u: string) => {
      g.shellCalls.push(`external ${u}`);
      return Promise.resolve();
    };
  });
}
const shellCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { shellCalls: string[] }).shellCalls);

async function clearClipboard(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ clipboard }) => {
    clipboard.clear();
  });
}
const clipText = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());
const clipHtml = (app: ElectronApplication) =>
  app.evaluate(async ({ clipboard }) => {
    const item = (await clipboard.read()).find((i) => i.types.includes("text/html"));
    return item === undefined ? "" : (await item.getType("text/html")).text();
  });

/** Right-clicks the link and picks an item; returns the menu's item names. */
async function viaMenu(page: Page, link: Locator, item: string | null): Promise<string[]> {
  await link.click({ button: "right" });
  await expect(linkMenu(page)).toBeVisible();
  const names = (await linkMenu(page).getByRole("menuitem").allTextContents()).map((s) => s.trim());
  if (item === null) await page.keyboard.press("Escape");
  else await linkMenu(page).getByRole("menuitem", { name: item, exact: true }).click();
  await expect(linkMenu(page)).toHaveCount(0);
  return names;
}

test.describe("016 US3 — links", () => {
  test("the link panel links a selection in the details and in a title, Enter applies, and a javascript: address is refused", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Read the docs", detailsMd: "See the guide here" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Read the docs").locator(".title").click();
      await selectText(details(page), "guide");
      await menu(page).locator('button[data-cmd="link"]').click();
      await expect(field(page, "link-text")).toHaveValue("guide");
      await expect(field(page, "link-href")).toBeFocused();
      await field(page, "link-href").fill("javascript:alert(1)");
      await page.keyboard.press("Enter");
      await expect(linkPanel(page).locator(".fm-link-error")).toHaveText("This address is not allowed.");
      await field(page, "link-href").fill("https://example.com/guide");
      await page.keyboard.press("Enter");
      await expect(linkPanel(page)).toBeHidden();
      await expect(details(page).locator('a[href="https://example.com/guide"]')).toHaveText("guide");
      await page.keyboard.press("Escape");
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("See the [guide](https://example.com/guide) here");

      // A title: the whole text when nothing is selected (PRD A5).
      await taskCard(page, "Read the docs").locator(".title").dblclick();
      const title = page.getByRole("textbox", { name: "Read the docs" });
      await selectText(title, "docs");
      await menu(page).locator('button[data-cmd="link"]').click();
      await expect(field(page, "link-text")).toHaveValue("docs");
      await field(page, "link-href").fill("https://example.com/docs");
      await page.keyboard.press("Enter");
      await expect(title.locator("a[href]")).toHaveText("docs");
      await page.keyboard.press("Enter");
      await expect.poll(() => readTask(dataDir, a.id)?.title_md).toBe("Read the [docs](https://example.com/docs)");
    } finally {
      await app.close();
    }
  });

  test("a right-click on a link opens Copy, Copy Link and Open Link in the details, a title, a reminder, a list row, the Archive and the Trash; Show in appears only on a stored file", async () => {
    const dataDir = freshDataDir();
    const ref = seedAsset(dataDir, PDF, "pdf", "application/pdf");
    expect(ref).toBe(PDF_REF);
    const now = Date.now();
    addTasks(dataDir, [
      task({ titleMd: "Row [site](https://example.com/row)", detailsMd: `Body [web](https://example.com/body) and [the file](${ref})`, position: 1 }),
      task({ titleMd: "Done [old](https://example.com/archive)", doneAt: now - DAY, position: 2 }),
      task({ titleMd: "Binned [gone](https://example.com/trash)", deletedAt: now - DAY, position: 3 }),
    ]);
    seedReminders(dataDir, [reminder({ textMd: "Call [desk](mailto:desk@example.com)" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await stubShell(app);
      // A list row (read-only text).
      const row = taskCard(page, "Row site");
      await clearClipboard(app);
      expect(await viaMenu(page, row.locator('a[href="https://example.com/row"]'), "Copy Link")).toEqual(["Copy", "Copy Link", "Open Link"]);
      await expect.poll(() => clipText(app)).toBe("https://example.com/row");
      await viaMenu(page, row.locator("a[href]"), "Copy");
      await expect.poll(() => clipText(app)).toBe("site");
      expect(await clipHtml(app)).toContain('href="https://example.com/row"');
      await viaMenu(page, row.locator("a[href]"), "Open Link");
      await expect.poll(() => shellCalls(app)).toContain("external https://example.com/row");

      // A reminder.
      await viaMenu(page, reminderCard(page, "Call desk").locator("a[href]"), "Copy Link");
      await expect.poll(() => clipText(app)).toBe("mailto:desk@example.com");

      // The details editor: a web link, then a stored file with Show in.
      await row.locator(".title").click({ position: { x: 4, y: 4 } });
      await expect(details(page)).toBeVisible();
      expect(await viaMenu(page, details(page).locator('a[href="https://example.com/body"]'), "Copy Link")).toEqual(["Copy", "Copy Link", "Open Link"]);
      await expect.poll(() => clipText(app)).toBe("https://example.com/body");
      const file = details(page).locator("a[href]", { hasText: "the file" });
      expect(await viaMenu(page, file, "Copy Link")).toEqual(["Copy", "Copy Link", "Open Link", REVEAL]);
      await expect.poll(() => clipText(app)).toBe(ref);
      await viaMenu(page, file, REVEAL);
      await expect.poll(async () => (await shellCalls(app)).some((c) => c.startsWith("show "))).toBe(true);
      await page.keyboard.press("Escape");

      // A title being edited.
      await row.locator(".title").dblclick();
      const title = page.getByRole("textbox", { name: "Row site" });
      await viaMenu(page, title.locator("a[href]"), "Copy Link");
      await expect.poll(() => clipText(app)).toBe("https://example.com/row");
      await page.keyboard.press("Escape");

      // The Archive and the Trash.
      await page.getByRole("button", { name: /^Archive/ }).click();
      await viaMenu(page, page.locator("li.arow", { hasText: "Done old" }).locator("a[href]"), "Copy Link");
      await expect.poll(() => clipText(app)).toBe("https://example.com/archive");
      await page.getByRole("button", { name: /^Trash/ }).click();
      await viaMenu(page, page.locator("li.arow", { hasText: "Binned gone" }).locator("a[href]"), "Copy Link");
      await expect.poll(() => clipText(app)).toBe("https://example.com/trash");
    } finally {
      await app.close();
    }
  });

  test("a right-click on a link in the search results shows the link context menu as in the list", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Found [needle](https://example.com/found)", doneAt: Date.now() - DAY })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await search(page, "needle", { includeArchiveTrash: true });
      await clearClipboard(app);
      expect(await viaMenu(page, elsewhereSection(page).locator("a[href]"), "Copy Link")).toEqual(["Copy", "Copy Link", "Open Link"]);
      await expect.poll(() => clipText(app)).toBe("https://example.com/found");
    } finally {
      await app.close();
    }
  });

  test("Cmd/Ctrl+Shift+C inside one link copies its address, and Edit › Copy Link is enabled exactly then; Cmd/Ctrl+click opens a safe link", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: "Keys", detailsMd: "Plain words and [a link](https://example.com/key) end" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await stubShell(app);
      await taskCard(page, "Keys").locator(".title").click();
      await caretAtEnd(details(page));
      await waitMenuState(app, "copyLink", { enabled: false });
      await selectText(details(page), "link");
      await waitMenuState(app, "copyLink", { enabled: true });
      await clearClipboard(app);
      await page.keyboard.press(`${mod}+Shift+c`);
      await expect.poll(() => clipText(app)).toBe("https://example.com/key");
      await clearClipboard(app);
      await clickMenu(app, "copyLink");
      await expect.poll(() => clipText(app)).toBe("https://example.com/key");
      // A selection outside the link.
      await selectText(details(page), "words");
      await waitMenuState(app, "copyLink", { enabled: false });

      await details(page).locator("a[href]").click({ modifiers: [mod] });
      await expect.poll(() => shellCalls(app)).toContain("external https://example.com/key");
    } finally {
      await app.close();
    }
  });

  test("a stored javascript: link keeps its look, has no menu and opens nothing: the panel opens on it in an editor, a popover says so in the Archive", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Bad [trap](javascript:alert(1)) here", detailsMd: "Body [evil](javascript:alert(2)) text", position: 1 });
    seedTasks(dataDir, [a, task({ titleMd: "Old [snare](javascript:alert(3))", doneAt: Date.now() - DAY, position: 2 })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await stubShell(app);
      const row = taskCard(page, "Bad trap here");
      const shown = row.locator("[data-unsafe-link]");
      await expect(shown).toHaveText("trap");
      await expect(shown).not.toHaveAttribute("href");
      // The link look: underlined like a link.
      expect(await shown.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("underline");
      await shown.click({ button: "right" });
      await expect(linkMenu(page)).toHaveCount(0);

      // A click on it in the list title starts editing, with the link selected and the panel's refusal line.
      await shown.click();
      await expect(linkPanel(page)).toBeVisible();
      await expect(field(page, "link-text")).toHaveValue("trap");
      await expect(field(page, "link-href")).toHaveValue("javascript:alert(1)");
      await expect(field(page, "link-href")).toBeFocused();
      await expect(linkPanel(page).locator(".fm-link-error")).toHaveText(UNSAFE);
      await expect(notice(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // In the details: no menu, Copy Link stays off, Cmd/Ctrl+click opens the panel.
      await row.locator(".title").click({ position: { x: 4, y: 4 } });
      await expect(details(page)).toBeVisible();
      const evil = details(page).locator("a[href]", { hasText: "evil" });
      await evil.click({ button: "right" });
      await expect(linkMenu(page)).toHaveCount(0);
      await selectText(details(page), "evil");
      await waitMenuState(app, "copyLink", { enabled: false });
      await caretAtEnd(details(page));
      await evil.click({ modifiers: [mod] });
      await expect(linkPanel(page)).toBeVisible();
      await expect(field(page, "link-text")).toHaveValue("evil");
      await expect(linkPanel(page).locator(".fm-link-error")).toHaveText(UNSAFE);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // In the Archive: a popover at the link, no notification; Esc closes it and the focus stays on the link.
      await page.getByRole("button", { name: /^Archive/ }).click();
      const snare = page.locator("li.arow", { hasText: "Old snare" }).locator("[data-unsafe-link]");
      await snare.click();
      await expect(page.locator(".link-unsafe-pop")).toHaveText(UNSAFE);
      await expect(page.locator(".link-unsafe-pop")).toHaveAttribute("role", "status");
      await expect(notice(page)).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.locator(".link-unsafe-pop")).toHaveCount(0);
      await snare.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".link-unsafe-pop")).toBeVisible();
      await expect(snare).toBeFocused();
      await page.mouse.click(5, 5);
      await expect(page.locator(".link-unsafe-pop")).toHaveCount(0);
      expect(await shellCalls(app)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

test.describe("016 US6 — Quote nesting and the Divider glyph", () => {
  test("Shift+click nests one level each time, a plain click removes one each time, Cmd/Ctrl+' still nests; the Divider glyph", async () => {
    const dataDir = freshDataDir();
    const a = task({ titleMd: "Quotes", detailsMd: "said" });
    seedTasks(dataDir, [a]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Quotes").locator(".title").click();
      await selectText(details(page), "said");
      const quote = menu(page).locator('button[data-cmd="quote"]');
      await quote.click({ modifiers: ["Shift"] });
      await quote.click({ modifiers: ["Shift"] });
      await expect(details(page).locator("blockquote blockquote")).toHaveCount(1);
      await page.keyboard.press(`${mod}+'`);
      await expect(details(page).locator("blockquote blockquote blockquote")).toHaveCount(1);
      await quote.focus();
      await page.keyboard.press("Shift+Enter");
      await expect(details(page).locator("blockquote blockquote blockquote blockquote")).toHaveCount(1);
      await expect(quote).toHaveAttribute("aria-pressed", "true");
      await quote.click();
      await expect(details(page).locator("blockquote blockquote blockquote")).toHaveCount(1);
      await expect(details(page).locator("blockquote blockquote blockquote blockquote")).toHaveCount(0);
      await expect(menu(page).locator('button[data-cmd="hr"] path')).toHaveAttribute("d", "M3 4h14M3 8h9M3 12h18M3 16h12M3 20h7");
      await page.keyboard.press("Escape");
      await expect.poll(() => readTask(dataDir, a.id)?.details_md).toBe("> > > said");
    } finally {
      await app.close();
    }
  });
});

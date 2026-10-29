/**
 * SC-002 end to end: the 001 acceptance scenarios that apply to a top-level task without subtasks, run
 * once with tasks and once with reminders through one adapter per kind; both must show the same result.
 * The differences in FR-025 (menu vs hover Delete, details panel, alerts, subtasks) are left out.
 */
import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { IS_MAC } from "./fixtures/settings";
import { freshDataDir, launchVesta, relaunch, type Launched } from "./fixtures/launch";
import { DAY, reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { clickRevealed } from "./fixtures/hover";
import { backToTasks } from "./fixtures/nav";

interface Kind {
  name: string;
  seed: (dataDir: string, texts: string[], extra?: Record<string, object>) => void;
  texts: (page: Page) => Promise<string[]>;
  card: (page: Page, text: string) => ReturnType<Page["locator"]>;
  editor: (page: Page) => ReturnType<Page["locator"]>;
  newEditor: (page: Page) => ReturnType<Page["getByRole"]>;
  openNew: (page: Page) => Promise<void>;
  delete: (page: Page, text: string) => Promise<void>;
  entry: (page: Page, text: string) => ReturnType<Page["locator"]>;
}

const rowsOf = (selector: string) => async (page: Page) => (await page.locator(`${selector} .title`).allTextContents()).map((s) => s.trim());
const cardOf = (selector: string) => (page: Page, text: string) =>
  page.locator(selector).filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });
const entryIn = (divisionId: (view: string) => string) => (page: Page, text: string) =>
  page.locator(`section[aria-labelledby$='${divisionId("")}']`).locator(".arow").filter({ has: page.locator(".title", { hasText: new RegExp(`^${text}$`) }) });

const TASKS: Kind = {
  name: "task",
  seed: (dir, texts, extra = {}) => {
    seedTasks(dir, texts.map((titleMd, i) => task({ titleMd, position: i + 1, ...extra[titleMd] })));
  },
  texts: rowsOf("li[data-kind='task']"),
  card: cardOf("li[data-kind='task']"),
  editor: (page) => page.locator("li[data-kind='task'] [role='textbox']"),
  newEditor: (page) => page.getByRole("textbox", { name: "New task…" }),
  openNew: (page) => page.getByRole("button", { name: /^New task…/ }).click(),
  delete: async (page, text) => {
    await clickRevealed(cardOf("li[data-kind='task']")(page, text), cardOf("li[data-kind='task']")(page, text).getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  },
  entry: entryIn(() => "-tasks-h"),
};

const REMINDERS: Kind = {
  name: "reminder",
  seed: (dir, texts, extra = {}) => {
    seedReminders(dir, texts.map((textMd, i) => reminder({ textMd, position: i + 1, ...extra[textMd] })));
  },
  texts: rowsOf("li[data-kind='rem']"),
  card: cardOf("li[data-kind='rem']"),
  editor: (page) => page.locator("li[data-kind='rem'] [role='textbox']"),
  newEditor: (page) => page.getByRole("textbox", { name: "New reminder…" }),
  openNew: (page) => page.getByRole("button", { name: /^New reminder…/ }).click(),
  delete: async (page, text) => {
    await clickRevealed(cardOf("li[data-kind='rem']")(page, text), cardOf("li[data-kind='rem']")(page, text).getByRole("button", { name: "Move to Trash" }));
  },
  entry: entryIn(() => "-rem-h"),
};

const toast = (page: Page) => page.getByTestId("notification");

async function pressUndoShortcut(app: ElectronApplication) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()?.getMenuItemById("undo")?.click(undefined, BrowserWindow.getAllWindows()[0]);
  });
}

function launchWith(kind: Kind, texts: string[], extra?: Record<string, object>): Promise<Launched> {
  const dataDir = freshDataDir();
  kind.seed(dataDir, texts, extra);
  return launchVesta({ dataDir });
}

for (const kind of [TASKS, REMINDERS]) {
  test.describe(`parity with 001 (SC-002): ${kind.name}`, () => {
    test("001 US1 2–4: Enter adds at the end and stays ready; empty text adds nothing; Esc discards", async () => {
      const { app, page } = await launchWith(kind, ["One"]);
      try {
        await kind.openNew(page);
        await kind.newEditor(page).fill("Two");
        await kind.newEditor(page).press("Enter");
        await expect(kind.newEditor(page)).toBeFocused();
        await kind.newEditor(page).fill("   ");
        await kind.newEditor(page).press("Enter"); // empty text creates nothing and closes the card (001 FR-013)
        await expect(kind.newEditor(page)).toHaveCount(0);
        await kind.openNew(page);
        await kind.newEditor(page).fill("Discarded");
        await kind.newEditor(page).press("Escape");
        expect(await kind.texts(page)).toEqual(["One", "Two"]);
      } finally {
        await app.close();
      }
    });

    test("001 US2 1–4, 6: inline edit saves on Enter and click outside, Esc discards, empty restores, closing saves", async () => {
      let run = await launchWith(kind, ["Alpha"]);
      const { page } = run;
      await kind.card(page, "Alpha").locator(".title").dblclick();
      await expect(page.getByText(`${IS_MAC ? "Return" : "Enter"} to save · Esc to cancel`)).toBeVisible();
      await kind.editor(page).fill("Beta");
      await kind.editor(page).press("Enter");
      await kind.card(page, "Beta").locator(".title").dblclick();
      await kind.editor(page).fill("Gamma");
      await kind.editor(page).press("Escape");
      await kind.card(page, "Beta").locator(".title").dblclick();
      await kind.editor(page).fill("  ");
      await kind.editor(page).press("Enter");
      await kind.card(page, "Beta").locator(".title").dblclick();
      await kind.editor(page).fill("Delta");
      await page.locator("header").click();
      expect(await kind.texts(page)).toEqual(["Delta"]);
      run = await relaunch(run);
      try {
        expect(await kind.texts(run.page)).toEqual(["Delta"]);
      } finally {
        await run.app.close();
      }
    });

    test("001 US4 1, 2, 5, 6, 9: done and delete show their notice; undo and Cmd/Ctrl+Z put it back in place; the latest action wins", async () => {
      const { app, page } = await launchWith(kind, ["A", "B", "C"]);
      try {
        await kind.card(page, "B").getByRole("checkbox").click();
        await expect(toast(page)).toContainText(/moved to the Archive\./);
        await toast(page).getByRole("button", { name: "Undo" }).click();
        await expect.poll(() => kind.texts(page)).toEqual(["A", "B", "C"]);

        await kind.delete(page, "B");
        await expect(toast(page)).toContainText(/moved to the Trash\./);
        await pressUndoShortcut(app);
        await expect.poll(() => kind.texts(page)).toEqual(["A", "B", "C"]);

        await kind.card(page, "A").getByRole("checkbox").click();
        await kind.delete(page, "C");
        await toast(page).getByRole("button", { name: "Undo" }).click();
        await expect.poll(() => kind.texts(page)).toEqual(["B", "C"]);
      } finally {
        await app.close();
      }
    });

    test("001 US5 4, 5, 7, 9: restore places by neighbours, shows 'Restored (undo)'; permanent delete needs a second click", async () => {
      const now = Date.now();
      const { app, page } = await launchWith(kind, ["A", "B", "C", "Gone"], {
        Gone: { deletedAt: now - 5 * DAY - 1000 },
      });
      try {
        await kind.delete(page, "B");
        await page.getByRole("button", { name: "Close" }).click({ force: true });
        await page.getByRole("button", { name: /^Trash/ }).click();
        await expect(kind.entry(page, "Gone").locator(".days")).toHaveText("25 days left");
        await kind.entry(page, "B").getByRole("button", { name: "Restore: B" }).click();
        await expect(toast(page)).toContainText(/” restored\./);
        await kind.entry(page, "Gone").getByRole("button", { name: "Delete permanently: Gone" }).click();
        await kind.entry(page, "Gone").getByRole("button", { name: "Click again to delete: Gone" }).click();
        await expect(kind.entry(page, "Gone")).toHaveCount(0);
        await backToTasks(page);
        expect(await kind.texts(page)).toEqual(["A", "B", "C"]);
      } finally {
        await app.close();
      }
    });
  });
}

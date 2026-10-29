// 005 US2, SC-001: every row of FR-015a and FR-015 through the real editors, in each allowed scope (T041).
// Each test applies the row (its typing shortcut, or a paste of its markdown until the menu exists), checks the
// rendering while editing, saves, compares the stored text, checks the card or panel, restarts, checks again,
// opens and closes the editor, and checks that the stored text did not change.
import { createHash } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import { join } from "node:path";
import { pasteText } from "./fixtures/editor";
import { freshDataDir, launchVesta, relaunch, type Launched } from "./fixtures/launch";
import { reminder, seedAsset, seedReminders, seedTasks, task } from "./fixtures/seed";

import { PDF, PNG, ROWS, type Refs, type Scope, type Step } from "./fixtures/md-corpus";

const SEED_TEXT = "Seeded item";

/** The row's element is shown (a line break has no box of its own, so it only has to be there). */
async function expectShown(root: Locator, selector: string): Promise<void> {
  if (selector === "") return;
  const el = root.locator(selector).first();
  if (selector.startsWith("br")) await expect(el).toBeAttached();
  else await expect(el).toBeVisible();
}

/** The ref seedAsset gives these bytes, known before the database exists. */
const refOf = (bytes: Buffer, ext: string) => `assets/${createHash("sha256").update(bytes).digest("hex")}.${ext}`;

function storedOf(dataDir: string, scope: Scope, id: string): string {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const sql =
      scope === "reminder"
        ? "select text_md as v from reminders limit 1"
        : scope === "title"
          ? "select title_md as v from tasks where id = ?"
          : "select details_md as v from tasks where id = ?";
    const row = (scope === "reminder" ? db.prepare(sql).get() : db.prepare(sql).get(id)) as { v: string };
    return row.v;
  } finally {
    db.close();
  }
}

function stored(dataDir: string, scope: Scope): string {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true, fileMustExist: true });
  try {
    const sql =
      scope === "reminder"
        ? "select text_md as v from reminders limit 1"
        : scope === "title"
          ? "select title_md as v from tasks limit 1"
          : "select details_md as v from tasks limit 1";
    return (db.prepare(sql).get() as { v: string }).v;
  } finally {
    db.close();
  }
}

const card = (page: Page, scope: Scope) =>
  page.locator(scope === "reminder" ? "li[data-kind='rem']" : "li[data-kind='task']").first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

/** Opens the scope's editor and returns it. */
async function openEditor(page: Page, scope: Scope) {
  if (scope === "details") {
    await card(page, "title").locator(".title").click();
    const editor = panel(page).getByRole("textbox", { name: "Details" });
    await expect(editor).toBeVisible();
    // Clicked at its top-left corner: the middle may be an embedded player.
    await editor.click({ position: { x: 4, y: 4 } });
    await expect(editor).toBeFocused();
    return editor;
  }
  await card(page, scope).locator(".title").dblclick();
  const editor = card(page, scope).locator(".ProseMirror");
  await expect(editor).toBeFocused();
  return editor;
}

async function closeEditor(page: Page, scope: Scope, save: boolean): Promise<void> {
  if (scope === "details") {
    if (save) await expect(panel(page).locator(".saved")).toHaveText("Saved");
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    return;
  }
  await page.keyboard.press(save ? "Enter" : "Escape");
  await expect(card(page, scope).locator(".ProseMirror")).toHaveCount(0);
}

async function apply(page: Page, steps: Step[]): Promise<void> {
  const target = page.locator(":focus");
  for (const step of steps) {
    if ("type" in step) await page.keyboard.type(step.type);
    else if ("press" in step) await page.keyboard.press(step.press);
    else await pasteText(target, step.paste);
  }
}

/** Where the saved row shows read-only: the card for titles and reminders, the reopened panel for details. */
async function shown(page: Page, scope: Scope) {
  if (scope !== "details") return card(page, scope).locator(".title");
  return openEditor(page, scope);
}

for (const row of ROWS) {
  for (const scope of row.scopes) {
    test(`${row.row} — ${scope}`, async () => {
      const dataDir = freshDataDir();
      const refs: Refs = { image: refOf(PNG, "png"), file: refOf(PDF, "pdf") };
      // An archived task keeps the stored files referenced, so the launch purge leaves them (FR-032).
      const keeper = task({
        titleMd: "Keeper",
        doneAt: Date.now(),
        detailsMd: `![k](${refs.image}) [k](${refs.file})`,
      });
      const seeded = task({ titleMd: SEED_TEXT });
      seedTasks(dataDir, [seeded, keeper]);
      if (scope === "reminder") seedReminders(dataDir, [reminder({ textMd: SEED_TEXT })]);
      seedAsset(dataDir, PNG, "png", "image/png");
      seedAsset(dataDir, PDF, "pdf", "application/pdf");
      const stored = (dataDir_: string, scope_: Scope) => storedOf(dataDir_, scope_, seeded.id);
      let run: Launched = await launchVesta({ dataDir });
      try {
        const editor = await openEditor(run.page, scope);
        if (scope !== "details") await run.page.keyboard.press("ControlOrMeta+a");
        await apply(run.page, row.steps(refs));
        await expectShown(editor, row.shows);
        await closeEditor(run.page, scope, true);
        expect(stored(dataDir, scope)).toBe(row.stored(refs));

        const view = await shown(run.page, scope);
        await expectShown(view, row.shows);
        if (row.row === "Emoji") await expect(view).toContainText("🎉");
        if (scope === "details") await closeEditor(run.page, scope, false);

        run = await relaunch(run);
        const again = await shown(run.page, scope);
        await expectShown(again, row.shows);
        if (scope === "details") await closeEditor(run.page, scope, false);
        await openEditor(run.page, scope);
        await closeEditor(run.page, scope, false);
        await run.page.waitForTimeout(700);
        expect(stored(dataDir, scope)).toBe(row.stored(refs));
      } finally {
        await run.app.close();
      }
    });
  }
}

test.describe("FR-015b and FR-020 in the real editors", () => {
  test("out-of-scope markdown in a title stays text, and Enter saves it", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: SEED_TEXT })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openEditor(page, "title");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("- not a list");
      await expect(card(page, "title").locator(".ProseMirror").locator("ul")).toHaveCount(0);
      await page.keyboard.press("Enter");
      await expect(card(page, "title").locator(".title")).toHaveText("- not a list");
      expect(stored(dataDir, "title")).toBe("\\- not a list");
    } finally {
      await app.close();
    }
  });

  test("a ticked checklist item is saved and the task stays active (FR-018)", async () => {
    const dataDir = freshDataDir();
    // A list written with `*`: the tick changes only that box, and the spelling stays (FR-018).
    seedTasks(dataDir, [task({ titleMd: SEED_TEXT, detailsMd: "* [ ] one\n* [ ] two" })]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const editor = await openEditor(page, "details");
      const item = editor.locator("li[data-item-type='task']").first();
      const box = await item.boundingBox();
      if (box === null) throw new Error("no item");
      await page.mouse.click(box.x + 6, box.y + 8);
      await expect(item).toHaveAttribute("data-checked", "true");
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      expect(stored(dataDir, "details")).toBe("* [x] one\n* [ ] two");
      await expect(card(page, "title")).toBeVisible();
    } finally {
      await app.close();
    }
  });

  for (const [kind, button, name] of [
    ["task", "New task…", "New task…"],
    ["reminder", "New reminder…", "New reminder…"],
  ] as const) {
    test(`the new ${kind} card formats as you type; Enter adds **bold**`, async () => {
      const dataDir = freshDataDir();
      seedTasks(dataDir, [task({ titleMd: SEED_TEXT })]);
      seedReminders(dataDir, [reminder({ textMd: SEED_TEXT })]);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.getByRole("button", { name: button }).click();
        const editor = page.getByRole("textbox", { name });
        await expect(editor).toBeFocused();
        await page.keyboard.type("**bold** ");
        await expect(editor.locator("strong")).toHaveText("bold");
        await page.keyboard.press("Enter");
        await expect(editor).toHaveText("");
        const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
        try {
          const sql =
            kind === "task"
              ? "select title_md as v from tasks order by created_at desc limit 1"
              : "select text_md as v from reminders order by position desc limit 1";
          await expect.poll(() => (db.prepare(sql).get() as { v: string } | undefined)?.v).toBe("**bold**");
        } finally {
          db.close();
        }
      } finally {
        await app.close();
      }
    });
  }

  test("the new subtask card formats as you type", async () => {
    const dataDir = freshDataDir();
    const parent = task({ titleMd: "Parent" });
    seedTasks(dataDir, [parent]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      const parentCard = page.locator("li[data-kind='task']").first();
      await parentCard.hover();
      await parentCard.getByRole("button", { name: "More actions" }).click();
      await page.getByRole("menuitem", { name: "New Subtask" }).click();
      const editor = page.getByRole("textbox", { name: "New subtask…" });
      await expect(editor).toBeFocused();
      await page.keyboard.type("**bold** ");
      await expect(editor.locator("strong")).toHaveText("bold");
      await page.keyboard.press("Enter");
      await expect(page.locator("li[data-kind='task'][data-parent] .title strong")).toHaveText("bold");
    } finally {
      await app.close();
    }
  });

  test("FR-021: pasted rich text keeps the scope's formatting; reopening changes nothing", async () => {
    const dataDir = freshDataDir();
    seedTasks(dataDir, [task({ titleMd: SEED_TEXT })]);
    const { app, page } = await launchVesta({ dataDir });
    const html = "<p><b>Bold</b> words</p><ul><li>one</li></ul><table><tr><th>h</th></tr><tr><td>c</td></tr></table>";
    try {
      await openEditor(page, "title");
      await page.keyboard.press("ControlOrMeta+a");
      await page.locator(":focus").evaluate((el, h) => {
        const data = new DataTransfer();
        data.setData("text/html", h);
        data.setData("text/plain", "Bold words one h c");
        el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      }, html);
      await page.keyboard.press("Enter");
      const title = stored(dataDir, "title");
      expect(title.startsWith("**Bold** words")).toBe(true);
      expect(title).not.toContain("\n");

      const editor = await openEditor(page, "details");
      await editor.evaluate((el, h) => {
        const data = new DataTransfer();
        data.setData("text/html", h);
        data.setData("text/plain", "");
        el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      }, html);
      await expect(panel(page).locator(".saved")).toHaveText("Saved");
      const details = stored(dataDir, "details");
      expect(details).toContain("**Bold** words");
      expect(details).toContain("- one");
      expect(details).toContain("| h |");
      await page.keyboard.press("Escape");
      await openEditor(page, "details");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
      expect(stored(dataDir, "details")).toBe(details);
    } finally {
      await app.close();
    }
  });
});

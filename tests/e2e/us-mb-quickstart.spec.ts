// 013 step L automated (T091): quickstart scenarios 4, 5, 7, 8, 11, 12, 13 and 14 end to end, one after the other, in
// one profile — the smoke a person would run by hand after the feature specs pass.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readTask } from "./fixtures/clock";
import { colorPicker, menu } from "./fixtures/editor";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { clickMenu, menuItem } from "./fixtures/menu";
import { answer, release, releasesFile } from "./fixtures/releases";
import { seedTasks, task } from "./fixtures/seed";
import { MOD, capture, closeSettings, dialog, setLanguage, showPane } from "./fixtures/settings";

const card = (page: Page, title: string) =>
  page.locator("li[data-kind='task']").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });
const toast = (page: Page) => page.getByTestId("notification");
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });
const button = (page: Page, cmd: string) => menu(page).locator(`button[data-cmd="${cmd}"]`);
const about = (page: Page) => page.getByTestId("about-dialog");
const locale = (lang: string) => JSON.parse(readFileSync(join(import.meta.dirname, `../../src/shared/i18n/locales/${lang}.json`), "utf8")) as Record<string, string>;

/** Puts the caret in (one argument) or selects from `a` to the end of `b` in the editor. */
async function select(editor: Locator, a: string, b?: string): Promise<void> {
  await editor.evaluate(
    (root: HTMLElement, [first, last]) => {
      root.focus();
      const find = (wanted: string) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const at = node.textContent?.indexOf(wanted) ?? -1;
          if (at >= 0) return { node, at };
        }
        throw new Error(`text not found: ${wanted}`);
      };
      const start = find(first);
      const range = document.createRange();
      if (last === null) {
        range.setStart(start.node, start.at + 1);
        range.collapse(true);
      } else {
        const end = find(last);
        range.setStart(start.node, start.at);
        range.setEnd(end.node, end.at + last.length);
      }
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    },
    [a, b ?? null] as const,
  );
}

async function hold(page: Page, from: Locator, releaseOver?: Locator): Promise<void> {
  const a = await from.boundingBox();
  if (a === null) throw new Error("no box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  if (releaseOver !== undefined) {
    const b = await releaseOver.boundingBox();
    if (b === null) throw new Error("no box");
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
  }
  await page.mouse.up();
}

test("013 quickstart 4, 5, 7, 8, 11–14 in one profile", async () => {
  test.setTimeout(180_000);
  const dataDir = freshDataDir();
  const edit = task({ titleMd: "Edit", detailsMd: "word here\n\none\n\ntwo", position: 3 });
  seedTasks(dataDir, [task({ titleMd: "Fix bike", position: 1 }), task({ titleMd: "Other", position: 2 }), edit]);
  const first = await launchVesta({ dataDir });
  const [major] = (await first.app.evaluate(({ app: a }) => a.getVersion())).split(".");
  const { app, page } = await relaunch(first, { env: { VESTA_TEST_RELEASES: releasesFile(answer([release(`${String(Number(major) + 1)}.0.0`)])) } });
  const stored = () => readTask(dataDir, edit.id)?.details_md;
  try {
    await expect(toast(page)).toHaveAttribute("data-kind", "update", { timeout: 10_000 });

    // 4: a menu command runs the same action as the toolbar and the keyboard.
    await card(page, "Fix bike").locator('[data-ctl="cb"]').focus();
    await clickMenu(app, "done");
    await expect(toast(page)).toContainText("“Fix bike” moved to the Archive.");
    await expect(card(page, "Fix bike")).toHaveCount(0);

    // 7: no cogwheel; Cmd/Ctrl+, opens Settings; the Updates tab carries the mark until its pane is shown.
    await expect(page.locator("header button.cog, header #settings-cog")).toHaveCount(0);
    await page.keyboard.press(`${MOD}+Comma`);
    await expect(dialog(page)).toBeVisible();
    await expect(page.getByTestId("updates-mark")).toBeVisible();
    await showPane(page, "Updates");
    await expect(page.getByTestId("updates-mark")).toHaveCount(0);

    // 5: a remapped New Task shows its new key in the menu; the labels follow the language; the context menu shares them.
    await capture(page, "New Task", `${MOD}+t`);
    await expect.poll(async () => (await menuItem(app, "newTask")).accelerator).toBe("CmdOrCtrl+T");
    await setLanguage(page, "pt-BR", "pt-BR");
    await expect.poll(async () => (await menuItem(app, "newTask")).label).toBe(locale("pt-BR").menuNewTask);
    await setLanguage(page, "en", "en");
    await closeSettings(page);
    await clickRevealed(card(page, "Other"), card(page, "Other").getByRole("button", { name: "More actions" }));
    expect((await page.getByRole("menuitem").allTextContents()).map((s) => s.trim())).toEqual(["New Subtask", "Show Details", "Reschedule", "Postpone For", "Alert Period…", "Move to Trash"]);
    await page.keyboard.press("Escape");

    // 8: About from the menu, License in its own view (015 FR-029), Esc back to About, Esc again closes.
    await clickMenu(app, "about");
    await expect(about(page)).toBeVisible();
    await about(page).getByRole("button", { name: "License", exact: true }).click();
    await expect(about(page).getByRole("document", { name: "License" })).toContainText("GNU AFFERO GENERAL PUBLIC LICENSE");
    await page.keyboard.press("Escape");
    await expect(about(page).getByRole("button", { name: "License", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(about(page)).toBeHidden();

    await card(page, "Edit").locator(".title").click();
    const editor = panel(page).getByRole("textbox", { name: "Details" });
    await editor.click();

    // 11: one Highlight button; a click toggles, a long press opens the picker.
    await expect(menu(page).getByRole("button", { name: "Highlight color", exact: true })).toHaveCount(0);
    await select(editor, "word", "word");
    await button(page, "mark").click();
    await expect.poll(stored).toBe("==word== here\n\none\n\ntwo");
    await button(page, "mark").click();
    await expect.poll(stored).toBe("word here\n\none\n\ntwo");
    await select(editor, "here", "here");
    await hold(page, button(page, "mark"));
    await expect(colorPicker(page)).toBeVisible();
    await page.keyboard.press("Escape");

    // 12: two paragraphs make one list of two items.
    await select(editor, "one", "two");
    await button(page, "bullet").click();
    await expect.poll(stored).toBe("word here\n\n- one\n- two");

    // 13: Indent and Outdent on that list, by the button and the keys.
    await select(editor, "two");
    await button(page, "indent").click();
    await expect.poll(stored).toBe("word here\n\n- one\n  - two");
    await page.keyboard.press(`${MOD}+BracketLeft`);
    await expect.poll(stored).toBe("word here\n\n- one\n- two");

    // 14: a long press on Table released over the list keeps the grid and the panel open.
    await select(editor, "word");
    await hold(page, button(page, "table"), card(page, "Other"));
    await expect(page.locator(".tsize:not([hidden])")).toBeVisible();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
  }
});

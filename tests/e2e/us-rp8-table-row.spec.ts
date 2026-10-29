// 018 FR-036, SC-010 (PRD Q286): in the details, the table options show on a third row of the floating menu while the
// cursor is in a table; the menu keeps its width, no button moves sideways, and it grows away from the text.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

const menu = (page: Page) => page.locator(".fmenu:not([hidden])");

async function caretIn(editor: Locator, text: string) {
  await editor.getByText(text, { exact: true }).first().click();
}

async function layout(page: Page) {
  return menu(page).evaluate((m) => {
    const r = m.getBoundingClientRect();
    const rows = [...m.querySelectorAll<HTMLElement>(".fm-row")];
    const xs = (i: number) =>
      [...(rows[i]?.querySelectorAll<HTMLElement>("button[data-cmd]") ?? [])].filter((b) => !b.hidden).map((b) => Math.round(b.getBoundingClientRect().x * 10) / 10);
    const label = m.querySelector(".fm-scope")?.getBoundingClientRect();
    const third = rows[2] !== undefined && !rows[2].hidden ? rows[2].getBoundingClientRect() : null;
    const first = rows[0]?.getBoundingClientRect();
    const second = rows[1]?.getBoundingClientRect();
    return { left: r.left, width: r.width, bottom: r.bottom, row0: xs(0), row1: xs(1), row2: xs(2), first, third, second, label };
  });
}

test("FR-036 in a table the third row appears; width and horizontal places hold; the menu stays above the text", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Notes", detailsMd: "Plain words here\n\n| head | col |\n| --- | --- |\n| cell | more |\n\nAfter the table" })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await page.locator("li[data-kind='task'] .title", { hasText: "Notes" }).click();
    const editor = page.getByTestId("details-panel").locator(".ProseMirror").last();
    await editor.click();
    await caretIn(editor, "Plain words here");
    await expect(menu(page)).toBeVisible();
    const out = await layout(page);
    expect(out.third).toBeNull();
    await caretIn(editor, "cell");
    await expect(menu(page).locator(".fm-row:not([hidden])")).toHaveCount(3);
    const inTable = await layout(page);
    expect(Math.abs(inTable.width - out.width)).toBeLessThanOrEqual(1);
    // T092: every button of rows one and two keeps its place on screen, within 1 px.
    const near = (a: number[], b: number[]) => {
      expect(a).toHaveLength(b.length);
      a.forEach((x, i) => {
        expect(Math.abs(x - (b[i] ?? Number.NaN))).toBeLessThanOrEqual(1);
      });
    };
    near(inTable.row0, out.row0);
    near(inTable.row1, out.row1);
    // The third row is below the second, and the label spans all three.
    if (inTable.third === null || inTable.first === undefined || inTable.second === undefined || inTable.label === undefined) throw new Error("missing rows");
    expect(inTable.third.top).toBeGreaterThanOrEqual(inTable.second.bottom);
    // The label is centered across the three rows it spans.
    const middle = (inTable.first.top + inTable.third.bottom) / 2;
    expect(Math.abs(inTable.label.top + inTable.label.height / 2 - middle)).toBeLessThanOrEqual(2);
    // The menu still sits above the line being edited.
    const caretTop = await editor.getByText("cell", { exact: true }).first().evaluate((el) => el.getBoundingClientRect().top);
    expect(inTable.bottom).toBeLessThanOrEqual(caretTop);
    // Keyboard: Down from the second row reaches the third.
    await menu(page).locator(".fm-row").nth(1).locator("button:not([hidden])").first().focus();
    await page.keyboard.press("ArrowDown");
    expect(await menu(page).locator(".fm-row").nth(2).evaluate((r) => r.contains(document.activeElement))).toBe(true);
    await caretIn(editor, "After the table");
    await expect(menu(page).locator(".fm-row:not([hidden])")).toHaveCount(2);
  } finally {
    await app.close();
  }
});

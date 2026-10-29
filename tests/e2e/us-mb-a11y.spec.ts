// 013 accessibility (T082, T088; SC-005 style): axe in light and dark on what 013 draws — the selected card in the
// four palettes, the scope bar, Settings with the update mark, About in both states and the two-row floating menu —
// and the keyboard rules: the scope bar's radiogroup and checkboxes by Tab and arrows, About keeping the focus.
import {
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from "@playwright/test";
import { expectNoA11yViolations } from "./fixtures/axe";
import { menu } from "./fixtures/editor";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { clickRevealed } from "./fixtures/hover";
import { clickMenu } from "./fixtures/menu";
import { answer, release, releasesFile } from "./fixtures/releases";
import { search } from "./fixtures/search";
import { seedTasks, staleTask, task } from "./fixtures/seed";
import {
  closeSettings,
  dialog,
  openSettings,
  showPane,
} from "./fixtures/settings";

const PALETTES = ["hearth", "system", "ubuntu", "minimal"] as const;
const DOC = ["Plain paragraph", "- one\n- two", "| h |\n| - |\n| cell |"].join(
  "\n\n",
);

const card = (page: Page, title: string) =>
  page
    .locator("li[data-kind='task']")
    .filter({
      has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }),
    });
const about = (page: Page) => page.getByTestId("about-dialog");
const details = (page: Page) =>
  page
    .getByRole("complementary", { name: "Details" })
    .getByRole("textbox", { name: "Details" });

async function newer(app: ElectronApplication): Promise<string> {
  const [major] = (await app.evaluate(({ app: a }) => a.getVersion())).split(
    ".",
  );
  return `${String(Number(major) + 1)}.0.0`;
}

async function caretIn(editor: Locator, text: string): Promise<void> {
  await editor.evaluate((root: HTMLElement, wanted) => {
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + 1);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error(wanted);
  }, text);
}

async function launch() {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [
    task({ titleMd: "Fix bike", position: 1 }),
    staleTask({ titleMd: "Renew passport", position: 2 }),
    task({ titleMd: "Paid rent", position: 3, doneAt: Date.now() - 1000 }),
    task({ titleMd: "Notes", detailsMd: DOC, position: 4 }),
  ]);
  const first = await launchVesta({ dataDir });
  const v = await newer(first.app);
  return relaunch(first, {
    env: { VESTA_TEST_RELEASES: releasesFile(answer([release(v)])) },
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`T082 T088 the selected card in every palette, the scope bar, Settings with the mark, About and the floating menu pass axe in ${colorScheme} mode`, async () => {
    test.setTimeout(180_000);
    const { app, page } = await launch();
    try {
      await page.emulateMedia({ colorScheme });
      await expect(page.getByTestId("notification")).toHaveAttribute(
        "data-kind",
        "update",
        { timeout: 10_000 },
      );

      for (const palette of PALETTES) {
        await openSettings(page, "General");
        await dialog(page).getByTestId("palette").selectOption(palette);
        // Hearth is the default and draws without the attribute.
        if (palette === "hearth")
          await expect(page.locator("html")).not.toHaveAttribute(
            "data-palette",
            /./,
          );
        else
          await expect(page.locator("html")).toHaveAttribute(
            "data-palette",
            palette,
          );
        await closeSettings(page);
        await card(page, "Fix bike").locator('[data-ctl="cb"]').focus();
        await expectNoA11yViolations(
          page,
          `${palette} ${colorScheme}: a selected card`,
        );
        await card(page, "Renew passport").locator('[data-ctl="cb"]').focus();
        await expectNoA11yViolations(
          page,
          `${palette} ${colorScheme}: a selected stale card`,
        );
        await search(page, "rent", { includeArchiveTrash: true });
        await expectNoA11yViolations(
          page,
          `${palette} ${colorScheme}: the scope bar`,
        );
        await page.keyboard.press("Escape");
      }

      await openSettings(page, "General");
      await expect(page.getByTestId("updates-mark")).toBeVisible();
      await expectNoA11yViolations(
        page,
        `${colorScheme}: Settings with the update mark`,
      );
      await showPane(page, "Updates");
      await expectNoA11yViolations(page, `${colorScheme}: Settings on Updates`);
      await closeSettings(page);

      await clickMenu(app, "about");
      await expect(about(page)).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: About`);
      await about(page)
        .getByRole("button", { name: "License", exact: true })
        .click();
      await expect(
        about(page).getByRole("document", { name: "License" }),
      ).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: About, License`);
      await page.keyboard.press("Escape");
      // 015 FR-029a: the Third-Party Licenses view.
      await about(page)
        .getByRole("button", { name: "Third-Party Licenses" })
        .click();
      await expect(
        about(page).getByRole("document", { name: "Third-Party Licenses" }),
      ).toBeVisible();
      await expectNoA11yViolations(
        page,
        `${colorScheme}: About, Third-Party Licenses`,
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(about(page)).toBeHidden();

      // 015: Settings on Alerts with the quick durations, the open Postpone For submenu, and the panel's History.
      await openSettings(page, "Alerts");
      await expectNoA11yViolations(
        page,
        `${colorScheme}: Settings on Alerts with the quick durations`,
      );
      await closeSettings(page);
      const stale = card(page, "Renew passport");
      await clickRevealed(
        stale,
        stale.getByRole("button", { name: "More actions" }),
      );
      await page.getByRole("menuitem", { name: "Postpone For" }).click();
      await expect(
        page.getByRole("menu", { name: "Postpone For" }),
      ).toBeVisible();
      await expectNoA11yViolations(
        page,
        `${colorScheme}: the Postpone For submenu`,
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await stale.locator(".title").click();
      await expect(page.locator(".panel-history li").first()).toBeVisible();
      await expectNoA11yViolations(
        page,
        `${colorScheme}: the details panel with History`,
      );
      await page.keyboard.press("Escape");

      await card(page, "Notes").locator(".title").click();
      const editor = details(page);
      await editor.click();
      for (const [text, label] of [
        ["Plain", "the details"],
        ["cell", "a table"],
      ] as const) {
        await caretIn(editor, text);
        await expect(menu(page)).toBeVisible();
        // 014 FR-016: ten and ten in the details; 018 FR-036: in a table the table options take a third row.
        await expect(menu(page).locator(".fm-row:not([hidden])")).toHaveCount(text === "Plain" ? 2 : 3);
        await expect(
          menu(page).locator(".fm-row").first().locator("button:not([hidden])"),
        ).toHaveCount(10);
        await expect(
          menu(page)
            .locator(".fm-row")
            .nth(1)
            .locator("button:not([hidden])"),
        ).toHaveCount(10);
        await expectNoA11yViolations(
          page,
          `${colorScheme}: the floating menu in ${label}`,
        );
      }
    } finally {
      await app.close();
    }
  });
}

test("T088 every new control has a name; the scope bar is one Tab stop plus two checkboxes with arrows inside; About keeps the focus", async () => {
  const { app, page } = await launch();
  try {
    await search(page, "rent", { includeArchiveTrash: false });
    const bar = page.locator("#search-scope");
    for (const control of await bar
      .locator("[role='radio'], input[type='checkbox']")
      .all())
      await expect(control).toHaveAccessibleName(/\S/);
    await bar.getByRole("radio", { name: "Active" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(bar.getByRole("radio", { name: "Everything" })).toBeFocused();
    await expect(
      bar.getByRole("radio", { name: "Everything" }),
    ).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Tab");
    await expect(
      bar.getByRole("checkbox", { name: "Match case" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      bar.getByRole("checkbox", { name: "Exact phrase" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(bar.getByRole("radio", { name: "Everything" })).toBeFocused();
    await page.keyboard.press("Escape");

    await openSettings(page, "General");
    await expect(
      dialog(page).getByRole("tab", { name: "Updates, update available" }),
    ).toBeVisible();
    await closeSettings(page);

    await clickMenu(app, "about");
    await expect(about(page)).toBeVisible();
    for (const state of ["main", "license"] as const) {
      for (const control of await about(page).locator("button, a[href]").all())
        await expect(control).toHaveAccessibleName(/\S/);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(i % 2 === 0 ? "Tab" : "Shift+Tab");
        await page.keyboard.press("Tab");
        expect(
          await about(page).evaluate((d) => d.contains(document.activeElement)),
          `${state} focus ${String(i)}`,
        ).toBe(true);
      }
      if (state === "main")
        await about(page)
          .getByRole("button", { name: "License", exact: true })
          .click();
    }
  } finally {
    await app.close();
  }
});

test("015 the Postpone For submenu, the durations row, the History list and the About buttons expose their roles and names", async () => {
  const { app, page } = await launch();
  try {
    const stale = card(page, "Renew passport");
    await clickRevealed(
      stale,
      stale.getByRole("button", { name: "More actions" }),
    );
    const item = page.getByRole("menuitem", { name: "Postpone For" });
    await expect(item).toHaveAttribute("aria-haspopup", "menu");
    await expect(item).toHaveAttribute("aria-expanded", "false");
    await item.click();
    await expect(item).toHaveAttribute("aria-expanded", "true");
    const row = page.getByRole("menu", { name: "Postpone For" });
    await expect(row).toHaveAttribute("aria-orientation", "horizontal");
    await expect(row.getByRole("menuitem")).toHaveText([
      "1h",
      "2h",
      "4h",
      "6h",
    ]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");

    // FR-016: History is a named region holding an ordered list, each entry with its words.
    await stale.locator(".title").click();
    const history = page.getByRole("region", { name: "History" });
    await expect(history).toBeVisible();
    await expect(history.locator("ol")).toBeVisible();
    for (const li of await history.getByRole("listitem").all())
      await expect(li).toHaveText(/\S/);
    await page.keyboard.press("Escape");

    await clickMenu(app, "about");
    await expect(
      about(page).getByRole("button", { name: "License", exact: true }),
    ).toBeFocused();
    await expect(
      about(page).getByRole("button", { name: "Third-Party Licenses" }),
    ).toBeVisible();
    await about(page)
      .getByRole("button", { name: "Third-Party Licenses" })
      .click();
    await expect(about(page)).toHaveAccessibleName("Third-Party Licenses");
    await expect(
      about(page).getByRole("document", { name: "Third-Party Licenses" }),
    ).toBeFocused();
  } finally {
    await app.close();
  }
});

// 016 T069: axe in light and dark on what 016 draws: the link panel and its refusal line, the link context menu, the
// history timeline, the redo notice, the Text color button, the dialog heads and the Logs window.
for (const colorScheme of ["light", "dark"] as const) {
  test(`016 the link panel, the link menu, the timeline, the redo notice and the dialog heads pass axe in ${colorScheme} mode`, async () => {
    test.setTimeout(120_000);
    const dataDir = freshDataDir();
    seedTasks(dataDir, [
      staleTask({ titleMd: "Linked [site](https://example.com)", detailsMd: "See [docs](https://example.com/docs) here", position: 1 }),
    ]);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await page.emulateMedia({ colorScheme });
      const row = card(page, "Linked site");

      // The redo notice: reschedule, then Undo.
      await clickRevealed(row, row.locator(".act.resched"));
      await page.getByTestId("notification").getByRole("button", { name: "Undo" }).click();
      await expect(page.getByTestId("notification").getByRole("button", { name: "Redo" })).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: the redo notice`);

      // The link context menu on a list row.
      await row.locator("a[href]").click({ button: "right" });
      await expect(page.getByRole("menu", { name: "Link" })).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: the link context menu`);
      await page.keyboard.press("Escape");

      // The details panel's timeline, then the link panel with its refusal line.
      await row.locator(".title").click({ position: { x: 4, y: 4 } });
      await expect(page.locator(".panel-history ol.timeline")).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: the history timeline`);
      await caretIn(details(page), "docs");
      await expect(menu(page).getByRole("button", { name: "Text color", exact: true })).toBeVisible();
      await menu(page).locator('button[data-cmd="link"]').click();
      const href = menu(page).getByRole("textbox", { name: "Link", exact: true });
      await href.fill("javascript:void(0)");
      await href.press("Enter");
      await expect(menu(page).locator(".fm-link-error")).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: the link panel with its refusal line`);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // The dialog heads and the Logs window.
      await openSettings(page, "Data");
      const head = page.locator("dialog.settings-dialog[open] .modal-head").first();
      await head.focus();
      await expect(head).toHaveAccessibleDescription(/Arrow keys move this window/);
      await expectNoA11yViolations(page, `${colorScheme}: Settings with its head focused`);
      await page.getByTestId("logs-open").click();
      const logsHead = page.locator("dialog.log-dialog[open] .modal-head");
      await logsHead.focus();
      await expect(logsHead).toHaveAccessibleDescription(/Arrow keys move this window/);
      await expectNoA11yViolations(page, `${colorScheme}: the Logs window`);
    } finally {
      await app.close();
    }
  });
}

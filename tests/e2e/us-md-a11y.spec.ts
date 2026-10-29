// 005 accessibility (quickstart scenario 17, T065; FR-026, FR-040, FR-041, SC-007).
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { expectNoA11yViolations } from "./fixtures/axe";
import { menu, selectText } from "./fixtures/editor";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedAsset, seedReminders, seedTasks, task } from "./fixtures/seed";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC",
  "base64",
);
const IMAGE = `assets/${createHash("sha256").update(PNG).digest("hex")}.png`;
const DETAILS = [
  "# Notes",
  '**Bold** *italic* `code` ~~gone~~ [colored]{color="#c3321eff"} ==marked== [hl]{bg="#ffe066ff"} [link](https://example.com)',
  "- [ ] open item\n- [x] done item",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
  "```js\nconst a = 1;\n```",
  "> quoted",
  `![photo.png](${IMAGE})`,
  "<details><summary>More</summary>\n\nhidden\n\n</details>",
].join("\n\n");

// FR-041: a color the user chose is shown as chosen, so it is not part of the contrast check.
const USER_COLORS = ["[data-vesta-span][data-color]", "[data-vesta-span][data-bg]"];
const panel = (page: Page) => page.getByRole("complementary", { name: "Details" });

async function launch() {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [
    task({
      titleMd: `**Formatted** [title]{color="#c3321eff" .underline} ==hl== ![p](${IMAGE})`,
      detailsMd: DETAILS,
      position: 1,
    }),
    task({ titleMd: "## Heading title", position: 2 }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "*Formatted* ~~reminder~~ `code`" })]);
  seedAsset(dataDir, PNG, "png", "image/png");
  return launchVesta({ dataDir });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`axe: formatted cards, the open panel and the menu pass in ${colorScheme} mode`, async () => {
    test.setTimeout(90_000);
    const { app, page } = await launch();
    try {
      await page.emulateMedia({ colorScheme });
      await expectNoA11yViolations(page, `${colorScheme}: formatted cards`, USER_COLORS);
      await page.locator("li[data-kind='task'] .title").first().click();
      const details = panel(page).getByRole("textbox", { name: "Details" });
      await expect(details).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: panel with formatted details`, USER_COLORS);
      await selectText(details, "Bold");
      await expect(menu(page)).toBeVisible();
      await expectNoA11yViolations(page, `${colorScheme}: menu over a selection`, USER_COLORS);
      await menu(page).getByRole("button", { name: "Link" }).click();
      await expectNoA11yViolations(page, `${colorScheme}: link prompt`, USER_COLORS);
    } finally {
      await app.close();
    }
  });
}

test("keyboard: into the panel, through its fields and the menu; Esc closes; focus returns to the card; Saved is announced", async () => {
  const { app, page } = await launch();
  try {
    const card = taskCard(page, "Heading title");
    // The keyboard way in: the card's menu, then Details.
    await card.getByRole("button", { name: "More actions" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Show Details" }).focus();
    await page.keyboard.press("Enter");
    const title = panel(page).getByRole("textbox", { name: "Title" });
    await expect(title).toBeVisible();
    await title.focus();

    // Tab: the title's menu, the details, the details' menu, then the override fields, all named.
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Bold");
    await page.keyboard.press("Tab");
    await expect(panel(page).getByRole("textbox", { name: "Details" })).toBeFocused();
    await page.keyboard.type("note");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Bold");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", "Italic");
    await page.keyboard.press("Tab");
    await expect(panel(page).getByRole("checkbox", { name: /Use the global default/ })).toBeFocused();

    // "Saved" is a polite status, announced without moving focus (FR-010, FR-040).
    const saved = panel(page).locator(".saved");
    await expect(saved).toHaveAttribute("role", "status");
    await expect(saved).toHaveAttribute("aria-live", "polite");
    await expect(saved).toHaveText("Saved");

    // Every control in the panel has a name.
    const unnamed = await panel(page)
      .locator("button, input, [role='textbox'], [role='separator']")
      .evaluateAll((els) =>
        els
          .filter((e) => !(e instanceof HTMLElement && e.closest("[hidden]")))
          .filter(
            (e) => (e.getAttribute("aria-label") ?? e.textContent).trim() === "" && e.closest("label") === null,
          )
          .map((e) => e.outerHTML.slice(0, 80)),
      );
    expect(unnamed).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(card.getByRole("checkbox")).toBeFocused();
  } finally {
    await app.close();
  }
});

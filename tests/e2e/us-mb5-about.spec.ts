// 013 US5 (spec scenarios 1–7; quickstart row 8; replaces 009's us-about4): About Vesta as a window of its own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";
import { clickMenu, menuItem } from "./fixtures/menu";
import {
  IS_MAC,
  MOD,
  dialog,
  openSettings,
  setLanguage,
  setTheme,
} from "./fixtures/settings";

const about = (page: import("@playwright/test").Page) =>
  page
    .getByRole("dialog", { name: /Vesta/ })
    .and(page.getByTestId("about-dialog"));
/** The same window in any of its three views (015 FR-028 to FR-030): named by its view's heading. */
const frame = (page: import("@playwright/test").Page) =>
  page.getByTestId("about-dialog");

/** The About sentence of each language, on this platform (FR-028). */
function sentence(lang: string): string {
  const table = JSON.parse(
    readFileSync(
      join(import.meta.dirname, `../../src/shared/i18n/locales/${lang}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
  return table[IS_MAC ? "aboutTextMac" : "aboutTextOther"] ?? "";
}

test.describe("013 US5 — About Vesta as a window of its own", () => {
  test("US5-1 the menu item opens a modal window with icon, wordmark, version, tagline, sentence, License and footnote", async () => {
    const { app, page } = await launchVesta();
    try {
      const version = await app.evaluate(({ app: a }) => a.getVersion());
      expect((await menuItem(app, "about")).label).toBe("About Vesta");
      await clickMenu(app, "about");
      const d = about(page);
      await expect(d).toBeVisible();
      await expect(d).toHaveAccessibleName("About Vesta");
      await expect(d.locator(".app-icon")).toBeVisible();
      // 018 FR-002 (Q270, Q284): the wordmark carries the CE superscript; the edition is written out under it.
      expect(await d.locator(".wordmark").evaluate((el) => el.firstChild?.textContent)).toBe("Vesta");
      await expect(d.locator(".wordmark")).toHaveText("VestaCE");
      await expect(d.locator(".about-edition")).toHaveText("Community Edition");
      await expect(d).toContainText(`Version ${version}`);
      await expect(d).toContainText("Nothing goes cold.");
      await expect(d).toContainText(sentence("en"));
      await expect(
        d.getByRole("button", { name: "License", exact: true }),
      ).toBeVisible();
      await expect(d).toContainText("AGPL-3.0 · © 2026 Leandro Gonçalves");
      // 015 FR-028, FR-028a: close, then License and Third-Party Licenses side by side, in that order; focus on License.
      expect(
        await d
          .getByRole("button")
          .evaluateAll((els) =>
            els.map((e) => e.getAttribute("aria-label") ?? e.textContent),
          ),
      ).toEqual(["Close", "License", "Third-Party Licenses"]);
      await expect(
        d.getByRole("button", { name: "License", exact: true }),
      ).toBeFocused();
      const [lic, third] = await Promise.all([
        d.getByRole("button", { name: "License", exact: true }).boundingBox(),
        d.getByRole("button", { name: "Third-Party Licenses" }).boundingBox(),
      ]);
      expect(Math.abs((lic?.y ?? 0) - (third?.y ?? 1))).toBeLessThanOrEqual(1);
      expect(lic?.x ?? 0).toBeLessThan(third?.x ?? 0);
    } finally {
      await app.close();
    }
  });

  test("015 US5 2 to 5: License and Third-Party Licenses replace About in the same frame; Esc and close return to About with the focus on their button; Esc on About closes it", async () => {
    const { app, page } = await launchVesta();
    try {
      const search = page.locator("#search");
      await search.focus();
      await clickMenu(app, "about");
      const d = frame(page);
      const licenseButton = d.getByRole("button", {
        name: "License",
        exact: true,
      });
      const thirdButton = d.getByRole("button", {
        name: "Third-Party Licenses",
      });
      await expect(about(page)).toBeVisible();

      // US5 2 (FR-029, FR-028a): a window headed License, the text focused, scrollable, selectable, only a close control.
      await licenseButton.click();
      await expect(d).toHaveAccessibleName("License");
      await expect(
        d.getByRole("heading", { level: 2, name: "License" }),
      ).toBeVisible();
      const text = d.getByRole("document", { name: "License" });
      await expect(text).toBeFocused();
      await expect(text).toContainText("GNU AFFERO GENERAL PUBLIC LICENSE");
      await expect(text).toContainText("END OF TERMS AND CONDITIONS");
      expect(
        await text.evaluate(
          (el) =>
            el.scrollHeight > el.clientHeight &&
            getComputedStyle(el).userSelect !== "none",
        ),
      ).toBe(true);
      await expect(d.getByRole("button")).toHaveCount(1);
      await expect(d.getByRole("button", { name: "Back" })).toHaveCount(0);
      // FR-029: 480 px wide (or the window less 32 px), at most 70 % of the window's height.
      const box = await d.boundingBox();
      const win = await page.evaluate(() => ({
        w: window.innerWidth,
        h: window.innerHeight,
      }));
      expect(
        Math.abs((box?.width ?? 0) - Math.min(480, win.w - 32)),
      ).toBeLessThanOrEqual(1);
      expect(box?.height ?? 0).toBeLessThanOrEqual(win.h * 0.7 + 1);

      // US5 4 (FR-030): Esc returns to About with the focus on License.
      await page.keyboard.press("Escape");
      await expect(about(page)).toBeVisible();
      await expect(licenseButton).toBeFocused();

      // US5 3 (FR-029a): no notices bundled in this build, one line in the selected language says so.
      await thirdButton.click();
      await expect(d).toHaveAccessibleName("Third-Party Licenses");
      await expect(
        d.getByRole("heading", { level: 2, name: "Third-Party Licenses" }),
      ).toBeVisible();
      const notices = d.getByRole("document", { name: "Third-Party Licenses" });
      await expect(notices).toBeFocused();
      await expect(notices).toHaveText(
        "Third-party licenses are included with release builds.",
      );
      // US5 4: the close button returns to About with the focus on Third-Party Licenses.
      await d.getByRole("button", { name: "Close" }).click();
      await expect(about(page)).toBeVisible();
      await expect(thirdButton).toBeFocused();

      // US5 5: Esc on About closes it and gives the focus back.
      await page.keyboard.press("Escape");
      await expect(d).toBeHidden();
      await expect(search).toBeFocused();
      // The close button on About closes it too; reopened, it shows About.
      await clickMenu(app, "about");
      await d.getByRole("button", { name: "Close" }).click();
      await expect(d).toBeHidden();
      await clickMenu(app, "about");
      await thirdButton.click();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(d).toBeHidden();
      await clickMenu(app, "about");
      await expect(about(page)).toBeVisible();
      await page.keyboard.press("Escape");

      // The missing-notices line follows the language.
      await openSettings(page, "General");
      await setLanguage(page, "pt-BR", "pt-BR");
      await page.keyboard.press("Escape");
      await clickMenu(app, "about");
      await d.locator(".about-buttons .btn").nth(1).click();
      const pt = JSON.parse(
        readFileSync(
          join(import.meta.dirname, "../../src/shared/i18n/locales/pt-BR.json"),
          "utf8",
        ),
      ) as Record<string, string>;
      await expect(d.getByRole("document")).toHaveText(
        pt.thirdPartyMissing ?? "",
      );
    } finally {
      await app.close();
    }
  });

  test("015 US5 6 (FR-031): the menu bar stays as Q183 says in the License and Third-Party Licenses views", async () => {
    const { app, page } = await launchVesta();
    try {
      await clickMenu(app, "about");
      for (const name of ["License", "Third-Party Licenses"]) {
        await frame(page).getByRole("button", { name, exact: true }).click();
        await page.keyboard.press(`${MOD}+Comma`);
        await page.waitForTimeout(200);
        await expect(dialog(page)).toBeHidden();
        for (const id of [
          "settings",
          "newTask",
          "find",
          "view:archive",
          "help",
        ])
          expect((await menuItem(app, id)).enabled, `${name} ${id}`).toBe(
            false,
          );
        await page.keyboard.press("Escape");
        await expect(about(page)).toBeVisible();
      }
    } finally {
      await app.close();
    }
  });

  test("US5-5 the main window does not react while About is open; FR-019 Q183 Mod+, leaves Settings closed", async () => {
    const { app, page } = await launchVesta();
    try {
      await clickMenu(app, "about");
      await expect(about(page)).toBeVisible();
      await page.keyboard.press(`${MOD}+Comma`);
      await page.keyboard.press(`${MOD}+n`);
      await page.waitForTimeout(300);
      await expect(dialog(page)).toBeHidden();
      await expect(
        page.getByRole("textbox", { name: "New task…" }),
      ).toHaveCount(0);
      for (const id of ["settings", "newTask", "find", "view:archive", "help"])
        expect((await menuItem(app, id)).enabled, id).toBe(false);
      expect((await menuItem(app, "about")).enabled).toBe(true);
      await page.keyboard.press("Escape");
      await expect(about(page)).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test("US5-6 Settings shows five panes and no About; US5-7 the sentence follows each language", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "General");
      await expect(dialog(page).getByRole("tab")).toHaveCount(5);
      await expect(
        dialog(page).locator('[role="tab"][data-pane="about"]'),
      ).toHaveCount(0);
      for (const lang of ["pt-BR", "it", "es-ES", "fr", "en"]) {
        await setLanguage(page, lang, lang);
        await page.keyboard.press("Escape");
        await clickMenu(app, "about");
        await expect(about(page)).toContainText(sentence(lang));
        await page.keyboard.press("Escape");
        await openSettings(page, "General");
      }
      // T057: About takes the theme's colors as the main window does.
      await setTheme(page, "Dark");
      await page.keyboard.press("Escape");
      await clickMenu(app, "about");
      const [bg, root] = await page.evaluate(() => [
        getComputedStyle(document.querySelector(".about-dialog") as Element)
          .backgroundColor,
        getComputedStyle(document.body).getPropertyValue("--bg").trim(),
      ]);
      expect(bg).not.toBe("");
      expect(root).not.toBe("");
    } finally {
      await app.close();
    }
  });
});

// 018 US2 (FR-023, FR-024, AC2–AC3; PRD Q274, Q276): About's second footnote line, and the name and identity notice
// above the unchanged license text, translated first and then in English, once in English.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchVesta } from "./fixtures/launch";
import { clickMenu } from "./fixtures/menu";
import { setLanguage } from "./fixtures/settings";

const about = (page: Page) => page.getByTestId("about-dialog");
const locale = (lang: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, `../../src/shared/i18n/locales/${lang}.json`), "utf8")) as Record<string, string>;
const english = readFileSync(join(import.meta.dirname, "../../TRADEMARKS.md"), "utf8")
  .replace(/^# [^\n]*\n+/, "")
  .trim();
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

test("US2-2 US2-3 FR-023 FR-024 About's second footnote line and the License notice in five languages", async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchVesta();
  try {
    for (const lang of ["pt-BR", "it", "es-ES", "fr", "en"]) {
      await setLanguage(page, lang, lang);
      await page.keyboard.press("Escape");
      await clickMenu(app, "about");
      const d = about(page);
      await expect(d).toBeVisible();
      const strings = locale(lang);
      // Two footnote lines: the license and copyright, then the reserved name and identity.
      const feet = d.locator(".about-footnote");
      await expect(feet).toHaveCount(2);
      await expect(feet.nth(0)).toHaveText(strings["aboutFootnote"] ?? "");
      await expect(feet.nth(1)).toHaveClass(/about-trademark/);
      await expect(feet.nth(1)).toHaveText(strings["aboutTrademark"] ?? "");
      // As tall as its content: the space below the last line equals the space above the icon, within 70 %.
      const m = await d.evaluate((el) => {
        const icon = el.querySelector(".about-card svg, .about-card .app-icon") as Element;
        const all = el.querySelectorAll(".about-footnote");
        const last = all[all.length - 1] as Element;
        const r = el.getBoundingClientRect();
        return { above: icon.getBoundingClientRect().top - r.top, below: r.bottom - last.getBoundingClientRect().bottom, height: r.height };
      });
      expect(Math.abs(m.below - m.above), lang).toBeLessThanOrEqual(2);
      expect(m.height, lang).toBeLessThanOrEqual((await page.evaluate(() => window.innerHeight)) * 0.7 + 1);

      await d.getByRole("button", { name: strings["aboutLicenseButton"] ?? "License", exact: true }).click();
      const region = d.locator(".about-license-text");
      await expect(region).toBeVisible();
      const parts = await region.evaluate((el) => ({
        first: el.firstElementChild?.className ?? "",
        local: el.querySelector(".trademark-local")?.textContent ?? null,
        en: el.querySelector(".trademark-en")?.textContent ?? null,
        enIsBeforeLicense: (el.querySelector(".trademark-en")?.nextSibling?.textContent ?? "").trimStart().startsWith("GNU AFFERO GENERAL PUBLIC LICENSE"),
      }));
      if (lang === "en") {
        expect(parts.local).toBeNull();
        expect(parts.first).toBe("trademark-en");
      } else {
        expect(parts.first, lang).toBe("trademark-local");
        expect(parts.local, lang).toBe(strings["trademarkNotice"]);
      }
      expect(norm(parts.en ?? ""), lang).toBe(norm(english));
      expect(parts.enIsBeforeLicense, lang).toBe(true);
      await page.keyboard.press("Escape");
      await expect(region).toBeHidden();

      await d.getByRole("button", { name: strings["aboutThirdParty"] ?? "Third-Party Licenses", exact: true }).click();
      await expect(d.locator(".about-license-text")).toBeVisible();
      await expect(d.locator(".trademark-local, .trademark-en")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(d).toBeHidden();
    }
  } finally {
    await app.close();
  }
});

/** 007 User Story 2: languages (quickstart 11, 12; US2-1 to US2-7; FR-012 to FR-019, SC-006; T049). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { DAY, HOUR, tick } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, task } from "./fixtures/seed";
import { MOD, menuLabels, openSettings, setLanguage, setOsLanguages } from "./fixtures/settings";

const LOCALES = join(import.meta.dirname, "../../src/shared/i18n/locales");
const load = (lang: string) => JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")) as Record<string, string>;
const EN = load("en");

const NOW = Date.now();
const DONE_AT = Date.UTC(2026, 2, 5, 14, 7);

function seedAll(dataDir: string) {
  const parent = task({ titleMd: "Parent task", position: 1 });
  seedTasks(dataDir, [
    parent,
    task({ titleMd: "Child task", parentId: parent.id, position: 1 }),
    task({ titleMd: "Old task", position: 2, createdAt: NOW - 12 * DAY - 3 * HOUR - 60_000 }),
    task({ titleMd: "Finished task", position: 3, doneAt: DONE_AT }),
    task({ titleMd: "Deleted task", position: 4, deletedAt: NOW - DAY }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "Call the bank" })]);
}

/** Every visible text and every name-like attribute in the window. */
function shownStrings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const el = n.parentElement;
      if (el === null || el.closest(".title, .md, [contenteditable]") !== null) continue;
      const text = n.textContent?.trim() ?? "";
      if (text !== "") out.add(text);
    }
    for (const el of Array.from(document.querySelectorAll("[aria-label], [title], [placeholder]"))) {
      for (const a of ["aria-label", "title", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v !== null && v.trim() !== "") out.add(v.trim());
      }
    }
    return [...out];
  });
}

/** English strings, without placeholders, that this language translates differently: none may show. */
function leftovers(shown: readonly string[], lang: string): string[] {
  const table = load(lang);
  // A string that is also one of this language's own values is legitimate (the Delete key keeps its name).
  const own = new Set(Object.values(table));
  const english = new Set(
    Object.entries(EN)
      .filter(([k, v]) => k !== "langName" && !v.includes("{") && v.length > 3 && table[k] !== v && !own.has(v))
      .map(([, v]) => v),
  );
  // The language list names each language in its own language (CHK003).
  for (const l of ["en", "pt-BR", "it", "es-ES", "fr"]) english.delete(load(l)["langName"] ?? "");
  return shown.filter((s) => english.has(s));
}

test.describe("007 US2 — use Vesta in my language", () => {
  test("Use system language: the first supported OS language, English otherwise (US2-1, US2-2; Clarifications)", async () => {
    for (const [list, lang, word] of [
      // 013: the toolbar's Archive button, now that Settings has no button of its own.
      ["de-DE,fr-FR", "fr", "Archives"],
      ["pt-PT", "pt-BR", "Arquivo"],
      ["ja-JP", "en", "Archive"],
    ] as const) {
      const { app, page } = await launchVesta({ env: { VESTA_TEST_OS_LANGS: list } });
      try {
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        await expect(page.locator("header").getByRole("button", { name: new RegExp(`^${word}`) })).toBeVisible();
      } finally {
        await app.close();
      }
    }
  });

  test("switching with Settings and the panel open keeps them, moves lang, the menu and the select's focus (US2-7, quickstart 11)", async () => {
    const dataDir = freshDataDir();
    seedAll(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Old task").locator(".title").click();
      await expect(page.getByRole("complementary", { name: "Details" })).toBeVisible();
      await openSettings(page, "General");
      await setLanguage(page, "fr", "fr");
      await expect(page.getByRole("dialog", { name: "Réglages" })).toBeVisible();
      await expect(page.locator("#set-language")).toBeFocused();
      await expect(page.getByRole("complementary", { name: "Détails" })).toBeVisible();
      const { top, edit } = await menuLabels(app);
      expect(top).toContain("Édition");
      expect(edit).toContain("Annuler");
    } finally {
      await app.close();
    }
  });

  test("an OS language change switches at once and keeps an open inline edit (US2-3, SC-004)", async () => {
    const dataDir = freshDataDir();
    seedAll(dataDir);
    const { app, page } = await launchVesta({ dataDir });
    try {
      await taskCard(page, "Old task").locator(".title").dblclick();
      const editor = page.getByRole("textbox", { name: "Old task" });
      await editor.fill("Old task, edited");
      await setOsLanguages(app, ["es-ES"]);
      await expect(page.locator("html")).toHaveAttribute("lang", "es-ES");
      await expect(page.locator("header").getByRole("button", { name: /^Archivo/ })).toBeVisible();
      await expect(page.locator("li[data-kind='task'] [role='textbox']")).toHaveText("Old task, edited");
    } finally {
      await app.close();
    }
  });

  test("a picked language stays across OS changes and restarts; Use system language follows the OS again (US2-4, US2-5)", async () => {
    const run = await launchVesta({ env: { VESTA_TEST_OS_LANGS: "en-US" } });
    let { app, page } = run;
    try {
      await setLanguage(page, "it", "it");
      await setOsLanguages(app, ["fr-FR"]);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.locator("html")).toHaveAttribute("lang", "it");
      await app.close();
      ({ app, page } = await launchVesta({ dataDir: run.dataDir, env: { VESTA_TEST_OS_LANGS: "fr-FR" } }));
      await expect(page.locator("html")).toHaveAttribute("lang", "it");
      await setLanguage(page, "system", "fr");
    } finally {
      await app.close();
    }
  });

  for (const lang of ["pt-BR", "it", "es-ES", "fr"]) {
    test(`${lang}: no English string on any screen; units and dates in the language (SC-006, quickstart 12)`, async () => {
      const dataDir = freshDataDir();
      seedAll(dataDir);
      const { app, page } = await launchVesta({ dataDir, env: { VESTA_TEST_OS_LANGS: lang } });
      try {
        await tick(page);
        const table = load(lang);
        const found: string[] = [];
        found.push(...leftovers(await shownStrings(page), lang));
        // The age label of a 12 d 3 h stale task uses the language's letters.
        await expect(taskCard(page, "Old task")).toContainText(`12${table["unitD"] ?? ""} 3${table["unitH"] ?? ""}`);
        // Context menu.
        const card = taskCard(page, "Parent task");
        await card.hover();
        await card.getByRole("button", { name: table["more"] }).click();
        found.push(...leftovers(await shownStrings(page), lang));
        await page.keyboard.press("Escape");
        // Details panel.
        await card.locator(".title").click();
        found.push(...leftovers(await shownStrings(page), lang));
        await page.keyboard.press("Escape");
        // Archive and Trash, with the date in the language's format.
        await page.getByRole("button", { name: new RegExp(table["archive"] ?? "") }).first().click();
        const tag = { "pt-BR": "pt-BR", it: "it-IT", "es-ES": "es-ES", fr: "fr-FR" }[lang] ?? "en-US";
        await expect(page.locator("main")).toContainText(new Intl.DateTimeFormat(tag, { dateStyle: "medium" }).format(DONE_AT));
        found.push(...leftovers(await shownStrings(page), lang));
        await page.getByRole("button", { name: new RegExp(table["trash"] ?? "") }).first().click();
        found.push(...leftovers(await shownStrings(page), lang));
        // Settings.
        // 013 FR-025: Settings is reached from the menu bar and its shortcut.
        await page.keyboard.press(`${MOD}+Comma`);
        await expect(page.getByRole("dialog", { name: table["settings"] })).toBeVisible();
        found.push(...leftovers(await shownStrings(page), lang));
        expect([...new Set(found)]).toEqual([]);
      } finally {
        await app.close();
      }
    });
  }
});

/** Search helpers for the 006 e2e specs (quickstart "Test controls"). */
import { expect, type Page } from "@playwright/test";

export const searchBox = (page: Page) => page.getByRole("searchbox", { name: "Search tasks and reminders" });
/** 013 FR-036 (PRD Q166): Match case and Exact phrase are checkboxes; Everything is the scope radio that adds the Archive and Trash. */
export const matchCaseToggle = (page: Page) => page.getByRole("checkbox", { name: "Match case" });
export const exactPhraseToggle = (page: Page) => page.getByRole("checkbox", { name: "Exact phrase" });
export const includeArchiveTrash = (page: Page) => page.getByRole("radio", { name: "Everything" });
export const activeOnly = (page: Page) => page.getByRole("radio", { name: "Active" });
export const elsewhereSection = (page: Page) => page.getByRole("region", { name: "Matches in Archive and Trash" });
/** The Search options button: it opens the scope bar that holds the toggles and the checkbox (HIG identity, B · Hearth). */
export const searchOptions = (page: Page) => page.getByRole("button", { name: "Search options" });

/** Shows the scope bar when no search keeps it open. */
export async function openSearchOptions(page: Page): Promise<void> {
  if ((await searchOptions(page).getAttribute("aria-pressed")) !== "true") await searchOptions(page).click();
  await expect(searchOptions(page)).toHaveAttribute("aria-pressed", "true");
}

/** Waits until the latest search request has its complete (not pending) reply applied. */
export async function searchSettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = document.documentElement.dataset;
        return d["searchSent"] !== undefined && d["searchSeq"] === d["searchSent"] && d["searchPending"] === "false";
      }),
    )
    .toBe(true);
}

async function setPressed(page: Page, box: ReturnType<typeof matchCaseToggle>, on: boolean): Promise<void> {
  await box.setChecked(on);
  if (on) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
}

/** Types a search (replacing the box's text), sets the toggles and the checkbox, and waits for the results. */
export async function search(
  page: Page,
  text: string,
  opts: { matchCase?: boolean; exactPhrase?: boolean; includeArchiveTrash?: boolean } = {},
): Promise<void> {
  await openSearchOptions(page);
  await setPressed(page, matchCaseToggle(page), opts.matchCase ?? false);
  await setPressed(page, exactPhraseToggle(page), opts.exactPhrase ?? false);
  const everything = opts.includeArchiveTrash ?? false;
  if ((await includeArchiveTrash(page).isChecked()) !== everything) await (everything ? includeArchiveTrash(page) : activeOnly(page)).click();
  await searchBox(page).fill(text);
  if (text.trim() !== "") await searchSettled(page);
}

/** The text of every range in the search highlight (CSS Custom Highlight API, research §7). */
export function highlights(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const h = CSS.highlights.get("vesta-search");
    return h === undefined ? [] : [...h].map((r) => (r as Range).toString());
  });
}

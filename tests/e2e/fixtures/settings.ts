/** 007 helpers: the Settings dialog, the language, the theme, shortcut capture and the selection (quickstart.md). */
import { expect, type ElectronApplication, type Page } from "@playwright/test";

export const IS_MAC = process.platform === "darwin";
/** The platform's Mod key for Playwright's keyboard.press. */
export const MOD = IS_MAC ? "Meta" : "Control";

export const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

/** The Settings panes (HIG identity review: Settings laid out as a settings window with a toolbar of panes). */
export type SettingsPane = "General" | "Alerts" | "Shortcuts" | "Data" | "Updates";

/** Shows a pane of the open Settings dialog; by its id, so it works in every language. */
export async function showPane(page: Page, pane: SettingsPane): Promise<void> {
  // The open dialog by its element, not its name: the name changes with the language.
  const tab = page.locator(`dialog.settings-dialog[open] [role="tab"][data-pane="${pane.toLowerCase()}"]`);
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Opens Settings with Mod+, so it works in every language (013: the cogwheel is gone), at `pane` when given. */
export async function openSettings(page: Page, pane?: SettingsPane): Promise<void> {
  await page.keyboard.press(`${MOD}+Comma`);
  await expect(page.locator("dialog.settings-dialog[open]")).toBeVisible();
  if (pane !== undefined) await showPane(page, pane);
}

export async function closeSettings(page: Page): Promise<void> {
  await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
}

/** Picks a language in Settings (opened if needed) and waits for <html lang>. */
export async function setLanguage(page: Page, value: string, expectLang?: string): Promise<void> {
  if (!(await page.locator("dialog.settings-dialog[open]").isVisible())) await openSettings(page);
  await showPane(page, "General");
  const select = page.locator("#set-language");
  await select.focus();
  await select.selectOption(value);
  if (expectLang !== undefined) await expect(page.locator("html")).toHaveAttribute("lang", expectLang);
}

export async function setTheme(page: Page, name: "Light" | "Dark" | "System"): Promise<void> {
  if (!(await dialog(page).isVisible())) await openSettings(page);
  await showPane(page, "General");
  await dialog(page).getByRole("radio", { name }).check();
}

/** Starts capture on an action's row and presses the given keys (Playwright notation, e.g. "Control+Shift+T"). */
export async function capture(page: Page, action: string, ...keys: string[]): Promise<void> {
  if (!(await dialog(page).isVisible())) await openSettings(page);
  await showPane(page, "Shortcuts");
  await dialog(page).getByRole("button", { name: `Change shortcut for ${action}` }).click();
  await expect(dialog(page).getByText("Press keys…")).toBeVisible();
  for (const k of keys) await page.keyboard.press(k);
}

/** The `data-id` of the card or entry that holds the focus, or null. */
export function shownSelection(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const li = document.activeElement?.closest<HTMLElement>("li[data-id]");
    return li?.dataset["id"] ?? null;
  });
}

/** The title or text of the selected card, for readable assertions. */
export function selectedTitle(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const li = document.activeElement?.closest<HTMLElement>("li[data-id]");
    return li?.querySelector(".title")?.textContent.trim() ?? null;
  });
}

/** Replaces the OS language list in main and re-reads it (contracts/ipc.md "Test hooks"). */
export async function setOsLanguages(app: ElectronApplication, list: string[]): Promise<void> {
  await app.evaluate((_e, l) => {
    const hook = (globalThis as unknown as { __vestaTest: { setOsLanguages: (l: string[]) => void; checkLanguage: () => void } }).__vestaTest;
    hook.setOsLanguages(l);
    hook.checkLanguage();
  }, list);
}

/** The application menu's top-level labels and the Edit menu's item labels. */
export function menuLabels(app: ElectronApplication): Promise<{ top: string[]; edit: string[] }> {
  return app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const top = menu?.items.map((i) => i.label) ?? [];
    const editMenu = menu?.items.find((i) => i.submenu?.items.some((s) => s.id === "undo") === true);
    const edit = editMenu?.submenu?.items.filter((i) => i.type !== "separator").map((i) => i.label) ?? [];
    return { top, edit };
  });
}

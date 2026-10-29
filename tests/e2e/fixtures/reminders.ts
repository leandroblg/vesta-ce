/** Locators and actions for the Reminders section, shared by the reminder specs (002). */
import { expect, type Page } from "@playwright/test";

export const reminderSection = (page: Page) => page.locator("section[aria-labelledby='rem-h']");
export const reminderList = (page: Page) => page.getByRole("list", { name: "Reminders" });
export const reminderCards = (page: Page) => reminderList(page).locator("li[data-kind='rem']");
export const reminderTexts = async (page: Page) => (await reminderCards(page).locator(".title").allTextContents()).map((s) => s.trim());
export const reminderToggle = (page: Page) => reminderSection(page).getByRole("button", { name: /^Reminders/ });
export const reminderCard = (page: Page, text: string) => reminderCards(page).filter({ has: page.locator(".title", { hasText: text }) });
export const newReminderEditor = (page: Page) => page.getByRole("textbox", { name: "New reminder…" });

export async function addReminder(page: Page, text: string): Promise<void> {
  const editor = newReminderEditor(page);
  if (!(await editor.isVisible())) await reminderSection(page).getByRole("button", { name: /^New reminder…/ }).click();
  await editor.fill(text);
  await editor.press("Enter");
  await expect(reminderCard(page, text)).toHaveCount(1);
}

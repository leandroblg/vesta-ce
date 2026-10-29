/** Navigation helpers (HIG identity review, B · Hearth): the pressed toolbar button is the way back. */
import type { Page } from "@playwright/test";

/** The current view's pressed toolbar button: Archive or Trash; pressing it again returns to the tasks. */
export const pressedView = (page: Page) => page.locator("header .navbtn[aria-pressed='true']");

export async function backToTasks(page: Page): Promise<void> {
  await pressedView(page).click();
}

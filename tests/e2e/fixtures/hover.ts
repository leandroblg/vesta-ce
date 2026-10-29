/** Clicking the hover-only buttons of a card (Edit, More actions, Move to Trash). */
import { expect, type Locator } from "@playwright/test";

/**
 * Hovers the card, then clicks a button it reveals. If the card loses hover before the click (the
 * hidden buttons let clicks through to the title, so Playwright's hit check fails and it retries without
 * moving the pointer), the hover is redone. Actionability checks stay on; the click happens once.
 */
export async function clickRevealed(card: Locator, button: Locator): Promise<void> {
  await expect(async () => {
    await card.hover();
    await button.click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

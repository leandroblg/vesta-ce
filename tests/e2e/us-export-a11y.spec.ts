// 008 accessibility (FR-002; quickstart 16; analysis A1; tasks T061).
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { writeDamaged } from "../unit/fixtures/damage";
import { expectNoA11yViolations } from "./fixtures/axe";
import { exportFolder, exportVia, importVia, nextDialog, notice, setFault, status } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { addTasks, task } from "./fixtures/seed";
import { openSettings } from "./fixtures/settings";

const announcer = (page: Page) => page.locator(".sr-only[role='status']");

function zipOf(variant: "valid" | "changedByte"): string {
  const zip = join(exportFolder(), `${variant}.zip`);
  writeDamaged(zip, variant);
  return zip;
}

test.describe("008 accessibility", () => {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe: the section idle, busy, with a message and an error, and the Undo import notice, ${colorScheme}`, async () => {
      const dataDir = freshDataDir();
      addTasks(dataDir, [task({ titleMd: "Mine" })]);
      const { app, page } = await launchVesta({ dataDir });
      try {
        await page.emulateMedia({ colorScheme });
        await openSettings(page, "Data");
        await page.getByTestId("export").scrollIntoViewIfNeeded();
        await expectNoA11yViolations(page, `section idle, ${colorScheme}`);
        await exportVia(app, page, exportFolder());
        await expectNoA11yViolations(page, `export message, ${colorScheme}`);
        await importVia(app, page, zipOf("changedByte"));
        await expect(status(page)).toHaveClass(/err/);
        await expectNoA11yViolations(page, `refusal message, ${colorScheme}`);
        await setFault(app, "slow-import");
        await nextDialog(app, zipOf("valid"));
        await page.getByTestId("import").click();
        await expect(status(page)).toHaveText("Importing…");
        await expectNoA11yViolations(page, `busy, ${colorScheme}`);
        await setFault(app, "");
        await expect(notice(page)).toHaveAttribute("data-kind", "importUndo", { timeout: 10_000 });
        await expectNoA11yViolations(page, `Undo import notice, ${colorScheme}`);
      } finally {
        await app.close();
      }
    });
  }

  test("every control is reachable by Tab with a name; outcomes are announced once; the countdown is not", async () => {
    const { app, page } = await launchVesta();
    try {
      await openSettings(page, "Data");
      const names: string[] = [];
      for (let i = 0; i < 80 && names.length < 3; i++) {
        await page.keyboard.press("Tab");
        const name = await page.evaluate(() => {
          const el = document.activeElement;
          if (el === null || el.closest(".data-section") === null) return null;
          const label = el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : null;
          return (el.getAttribute("aria-label") ?? label ?? el.textContent).trim();
        });
        if (name !== null && name !== "" && !names.includes(name)) names.push(name);
      }
      expect(names).toEqual(["Export", "Include logs", "Import"]);
      await expect(status(page)).toHaveAttribute("role", "status");
      await expect(status(page)).toHaveAttribute("aria-live", "polite");

      await importVia(app, page, zipOf("valid"));
      await expect(notice(page)).toHaveAttribute("role", "status");
      const countdown = page.getByTestId("undo-countdown");
      await expect(countdown).toHaveAttribute("aria-hidden", "true");
      await expect(countdown).toContainText(/seconds? left/);
      await page.getByTestId("undo-import").focus();
      await expect(page.getByTestId("undo-import")).toBeFocused();
      await expect(page.getByTestId("undo-import")).toHaveAccessibleName("Undo import");
      // Ending the offer is announced once, in the polite region.
      await notice(page).hover();
      await notice(page).getByRole("button", { name: "Close" }).click();
      await expect(announcer(page)).toHaveText("Undo import is no longer available.");
    } finally {
      await app.close();
    }
  });
});

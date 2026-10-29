/** 015 User Story 2, scenarios 8 and 9: the four quick durations in Settings › Alerts (FR-012, FR-013, PRD Q207). */
import { expect, test, type Page } from "@playwright/test";
import { taskCard, waitBlinksDone } from "./fixtures/alerts";
import { HOUR, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { menuItem } from "./fixtures/menu";
import { seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";

const group = (page: Page, name: string) => dialog(page).getByRole("group", { name });
const field = (page: Page, setting: string, unit: "Days" | "Hours" | "Minutes") => group(page, setting).getByRole("spinbutton", { name: unit });

async function setDuration(page: Page, setting: string, d: string, h: string, m: string) {
  await field(page, setting, "Days").fill(d);
  await field(page, setting, "Hours").fill(h);
  await field(page, setting, "Minutes").fill(m);
}

function storedSetting(page: Page, key: string): Promise<number> {
  return page.evaluate(async (k) => {
    const r = await window.vesta.app.getInitialState();
    return r.ok ? ((r.value.alertSettings as unknown as Record<string, number>)[k] ?? -1) : -1;
  }, key);
}

test("015 US2 8–9: four duration rows; a change shows at once in every menu and applies to later reschedules only", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Old", position: 1, createdAt: Date.now() - 30 * HOUR }), task({ titleMd: "Fresh", position: 2, createdAt: Date.now() - HOUR })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await tick(page);
    await waitBlinksDone(page);
    // A task rescheduled for 4h before the change keeps its 4 hours.
    const old = taskCard(page, "Old");
    const id = (await old.getAttribute("data-id")) ?? "";
    await clickRevealed(old, old.getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "Postpone For" }).click();
    await page.getByRole("menu", { name: "Postpone For" }).getByRole("menuitem", { name: "4h" }).click();
    await expect.poll(() => readTask(dataDir, id)?.reschedule_for_min).toBe(240);

    await openSettings(page, "Alerts");
    await expect(dialog(page).getByRole("heading", { name: "Quick reschedule durations" })).toBeVisible();
    for (const [name, hours] of [["First", "1"], ["Second", "2"], ["Third", "4"], ["Fourth", "6"]] as const) {
      await expect(field(page, name, "Days")).toHaveValue("0");
      await expect(field(page, name, "Hours")).toHaveValue(hours);
      await expect(field(page, name, "Minutes")).toHaveValue("0");
    }

    await setDuration(page, "Third", "0", "3", "0");
    await expect.poll(() => storedSetting(page, "quickReschedule3Min")).toBe(180);
    await expect.poll(async () => (await menuItem(app, "postponeFor3")).label).toBe("3h");

    // Out of range: the field's error, as for the tolerance, and nothing stored (A1).
    await setDuration(page, "Fourth", "0", "0", "59");
    await expect(group(page, "Fourth").locator("..")).toContainText("The minimum is 1 hour.");
    // 016 FR-032 (PRD Q237): days 30 zero the hours and minutes; the 30 days apply at once.
    await setDuration(page, "Fourth", "30", "0", "1");
    await expect(field(page, "Fourth", "Minutes")).toHaveValue("0");
    await expect.poll(() => storedSetting(page, "quickReschedule4Min")).toBe(43_200);
    await setDuration(page, "Fourth", "0", "6", "0");
    await expect.poll(() => storedSetting(page, "quickReschedule4Min")).toBe(360);
    await closeSettings(page);

    const fresh = taskCard(page, "Fresh");
    await clickRevealed(fresh, fresh.getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "Postpone For" }).click();
    await expect(page.getByRole("menu", { name: "Postpone For" }).getByRole("menuitem")).toHaveText(["1h", "2h", "3h", "6h"]);
    await page.keyboard.press("Escape");
    expect(readTask(dataDir, id)?.reschedule_for_min).toBe(240);
  } finally {
    await app.close();
  }
});

/** 003 User Story 5: the Archive shows which done tasks had been stale (T056). */
import { expect, test, type Page } from "@playwright/test";
import { formatAge } from "../../src/domain/age";
import { DAY, HOUR } from "./fixtures/clock";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { backToTasks } from "./fixtures/nav";

const EN = { d: "d", h: "h", m: "m" };
const archiveRow = (page: Page, title: string) =>
  page.locator("li.arow").filter({ has: page.locator(".title", { hasText: new RegExp(`^${title}$`) }) });

test("003 US5 — a done task that was ever stale shows a gray 'stale' tag and its total time; others do not (scenarios 1–4)", async () => {
  const now = Date.now();
  const dataDir = freshDataDir();
  const parent = task({ titleMd: "Parent done", createdAt: now - 5 * DAY, doneAt: now - DAY, wasStale: false });
  seedTasks(dataDir, [
    task({ titleMd: "Was stale", createdAt: now - 12 * DAY - 5 * HOUR, doneAt: now, wasStale: true, staleSince: now - 11 * DAY }),
    task({ titleMd: "Rescheduled once", createdAt: now - 3 * DAY, doneAt: now - HOUR, wasStale: true, staleSince: null }),
    task({ titleMd: "Never stale", createdAt: now - 2 * HOUR, doneAt: now - HOUR }),
    parent,
    task({ titleMd: "Stale sub", parentId: parent.id, createdAt: now - 4 * DAY, doneAt: now - DAY, leftWithId: parent.id, wasStale: true }),
    task({ titleMd: "Deleted stale", createdAt: now - 3 * DAY, deletedAt: now - HOUR, wasStale: true }),
    task({ titleMd: "Clock changed", createdAt: now, doneAt: now - HOUR, wasStale: true }),
  ]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await page.getByRole("button", { name: /^Archive/ }).click();
    const stale = archiveRow(page, "Was stale");
    await expect(stale.locator(".gtag")).toHaveText(`Stale · ${formatAge(12 * DAY + 5 * HOUR, EN)} from creation`);
    expect(await stale.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await archiveRow(page, "Never stale").evaluate((el) => getComputedStyle(el).backgroundColor),
    );
    await expect(archiveRow(page, "Rescheduled once").locator(".gtag")).toContainText("2d 23h from creation");
    await expect(archiveRow(page, "Never stale").locator(".gtag")).toHaveCount(0);
    await expect(archiveRow(page, "Parent done").locator(".gtag")).toHaveCount(0);
    await expect(archiveRow(page, "Stale sub").locator(".gtag")).toContainText("3d 0h from creation");
    await expect(archiveRow(page, "Clock changed").locator(".gtag")).toContainText("0m from creation");

    await backToTasks(page);
    await page.getByRole("button", { name: /^Trash/ }).click();
    await expect(page.locator("li", { hasText: "Deleted stale" }).locator(".gtag")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

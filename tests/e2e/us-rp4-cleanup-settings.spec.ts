// 018 US4 (AC1–AC3, AC7–AC12; FR-014 to FR-020d, FR-037; SC-005; PRD Q273, Q277–Q279, Q282, Q287–Q289): Settings →
// Data → Automatic cleanup: defaults, clamping, the refused zero, the confirmations, the save timing and the countdown.
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { HOUR, advanceClock } from "./fixtures/clock";
import { confirmRequests, nextConfirm } from "./fixtures/files";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";
import { DAY, seedTasks, task } from "./fixtures/seed";

const group = (page: Page, which: "archive" | "trash") => dialog(page).getByTestId(`cleanup-${which}`);
const field = (page: Page, which: "archive" | "trash", name: "Years" | "Days" | "Hours") => group(page, which).getByLabel(name, { exact: true });

function setting(dataDir: string, key: string): unknown {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    const row = db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
  } finally {
    db.close();
  }
}

async function values(page: Page, which: "archive" | "trash") {
  return Promise.all((["Years", "Days", "Hours"] as const).map((n) => field(page, which, n).inputValue()));
}

/** Done rows two hours old, unchanged for a while, so the Archive cleanup's count would take them. */
function oldDone(dataDir: string, n: number) {
  const now = Date.now();
  seedTasks(dataDir, Array.from({ length: n }, (_, i) => task({ titleMd: `Done ${String(i)}`, doneAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR })));
}

test("(a) (b) (c) defaults, the field maximums while typing, a refused zero total", async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVesta({ dataDir });
  try {
    await openSettings(page, "Data");
    const pane = dialog(page);
    const order = await pane.locator("section.sset h3").allTextContents();
    expect(order.indexOf("Automatic cleanup")).toBeGreaterThan(-1);
    expect(order.indexOf("Automatic cleanup")).toBeLessThan(order.indexOf("Logs"));
    await expect(group(page, "archive").getByRole("checkbox")).toBeChecked();
    await expect(group(page, "trash").getByRole("checkbox")).toBeChecked();
    expect(await values(page, "archive")).toEqual(["10", "0", "0"]);
    expect(await values(page, "trash")).toEqual(["0", "30", "0"]);
    await expect(group(page, "archive")).toContainText("Checked once an hour.");
    await expect(group(page, "trash")).toContainText("Years 0 to 1000, days 0 to 364, hours 0 to 23");
    // (b) clamped at once.
    await field(page, "trash", "Years").fill("1001");
    await expect(field(page, "trash", "Years")).toHaveValue("1000");
    await field(page, "trash", "Days").fill("365");
    await expect(field(page, "trash", "Days")).toHaveValue("364");
    await field(page, "trash", "Hours").fill("24");
    await expect(field(page, "trash", "Hours")).toHaveValue("23");
    await page.keyboard.press("Tab");
    // (c) a zero total is refused.
    for (const n of ["Years", "Days", "Hours"] as const) await field(page, "archive", n).fill("0");
    await page.keyboard.press("Tab");
    await expect(group(page, "archive")).toContainText("The minimum is 1 hour.");
    await page.waitForTimeout(2100);
    expect(setting(dataDir, "archiveCleanupHours")).toBe(87_600);
  } finally {
    await app.close();
  }
});

test("(d) (e) (f) a shorter time over items asks with the count; Cancel restores; Remove starts a countdown that survives a reopen and a relaunch", async () => {
  const dataDir = freshDataDir();
  oldDone(dataDir, 2);
  let launched = await launchVesta({ dataDir });
  let { app, page } = launched;
  try {
    await openSettings(page, "Data");
    await nextConfirm(app, false);
    await field(page, "archive", "Years").fill("0");
    await field(page, "archive", "Hours").fill("1");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await confirmRequests(app)).at(-1)).toEqual({ name: "confirmCleanupArchive", folder: "2" });
    await expect.poll(() => values(page, "archive")).toEqual(["10", "0", "0"]);
    expect(setting(dataDir, "archiveCleanupHours")).toBe(87_600);
    await nextConfirm(app, true);
    await field(page, "archive", "Years").fill("0");
    await field(page, "archive", "Hours").fill("1");
    await page.keyboard.press("Enter");
    const countdown = group(page, "archive").getByTestId("cleanup-archive-countdown");
    await expect(countdown).toHaveText(/^Takes effect in 59:5\d\.$/);
    const first = await countdown.textContent();
    await expect.poll(() => countdown.textContent(), { timeout: 3000 }).not.toBe(first);
    expect(setting(dataDir, "archiveCleanupHours")).toBe(1);
    // (e) reopened, the countdown continues.
    await closeSettings(page);
    await openSettings(page, "Data");
    await expect(countdown).toHaveText(/^Takes effect in 59:[45]\d\.$/);
    // (e) relaunched, it continues too.
    launched = await relaunch(launched);
    ({ app, page } = launched);
    await openSettings(page, "Data");
    await expect(group(page, "archive").getByTestId("cleanup-archive-countdown")).toHaveText(/^Takes effect in 5\d:\d\d\.$/);
    // (f) after the hour it is gone.
    await advanceClock(app, HOUR);
    await closeSettings(page);
    await openSettings(page, "Data");
    await expect(group(page, "archive").getByTestId("cleanup-archive-countdown")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("(g) (h) turning the Trash cleanup off asks, the Archive cleanup off does not; off, the fields keep their values", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "Gone", deletedAt: Date.now() - DAY })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await openSettings(page, "Data");
    const before = (await confirmRequests(app)).length;
    await nextConfirm(app, false);
    await group(page, "trash").getByRole("checkbox").click();
    await expect.poll(async () => (await confirmRequests(app)).at(-1)?.name).toBe("confirmTrashOff");
    await expect(group(page, "trash").getByRole("checkbox")).toBeChecked();
    await nextConfirm(app, true);
    await group(page, "trash").getByRole("checkbox").click();
    await expect(group(page, "trash").getByRole("checkbox")).not.toBeChecked();
    await expect(field(page, "trash", "Days")).toBeDisabled();
    expect(await values(page, "trash")).toEqual(["0", "30", "0"]);
    const asked = (await confirmRequests(app)).length;
    await group(page, "archive").getByRole("checkbox").click();
    await expect(group(page, "archive").getByRole("checkbox")).not.toBeChecked();
    expect((await confirmRequests(app)).length).toBe(asked);
    expect(asked - before).toBe(2);
    await closeSettings(page);
    await page.getByRole("button", { name: /^Trash/ }).click();
    await expect(page.locator(".days")).toHaveCount(0);
    await expect(page.locator(".view-head")).toContainText("They stay here until you delete them.");
  } finally {
    await app.close();
  }
});

test("(i) (j) (k) (l) when a typed time is saved: on leaving the group, on Enter or after 2 s; a shorter one over items only when confirmed", async () => {
  const dataDir = freshDataDir();
  oldDone(dataDir, 1);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await openSettings(page, "Data");
    // (i) a shorter time over items asks nothing while typing or resting, nor on a move between its fields.
    await field(page, "archive", "Years").fill("0");
    await field(page, "archive", "Hours").fill("1");
    await page.waitForTimeout(2100);
    await field(page, "archive", "Days").focus();
    await page.waitForTimeout(300);
    expect((await confirmRequests(app)).length).toBe(0);
    expect(setting(dataDir, "archiveCleanupHours")).toBe(87_600);
    // (k) closing Settings drops it: nothing asked or saved.
    await closeSettings(page);
    expect((await confirmRequests(app)).length).toBe(0);
    await openSettings(page, "Data");
    expect(await values(page, "archive")).toEqual(["10", "0", "0"]);
    // (j) a longer time saves after 2 s with the focus still in the group, with no dialog, and starts the countdown.
    await field(page, "archive", "Years").fill("20");
    await page.waitForTimeout(2100);
    expect(setting(dataDir, "archiveCleanupHours")).toBe(175_200);
    await expect(group(page, "archive").getByTestId("cleanup-archive-countdown")).toBeVisible();
    // (l) a shorter Trash time with nothing to remove saves within the 2 s, without a dialog.
    await field(page, "trash", "Days").fill("5");
    await page.waitForTimeout(2100);
    expect(setting(dataDir, "trashCleanupHours")).toBe(120);
    expect((await confirmRequests(app)).length).toBe(0);
    // (k) a longer time typed and Settings closed within the 2 s is saved at once.
    await field(page, "trash", "Days").fill("60");
    await page.waitForTimeout(300);
    await closeSettings(page);
    await expect.poll(() => setting(dataDir, "trashCleanupHours")).toBe(1440);
  } finally {
    await app.close();
  }
});

// 018 FR-037, SC-011 (PRD Q288, Q289; constitution VI's exception, v1.3.0): every group of time fields saves its typed
// time once: when the focus leaves the group, on Enter, or 2 s after the last keystroke or move between its fields,
// never while moving between them; closing Settings saves a pending time at once.
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, test, type Page } from "@playwright/test";
import { taskCard } from "./fixtures/alerts";
import { confirmRequests } from "./fixtures/files";
import { readTask } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { closeSettings, dialog, openSettings } from "./fixtures/settings";

const GROUPS: { legend: string; key: string }[] = [
  { legend: "Default alert period", key: "alertPeriodMin" },
  { legend: "Re-blink interval", key: "reblinkIntervalMin" },
  { legend: "Reschedule tolerance", key: "rescheduleToleranceMin" },
  { legend: "First", key: "quickReschedule1Min" },
  { legend: "Second", key: "quickReschedule2Min" },
  { legend: "Third", key: "quickReschedule3Min" },
  { legend: "Fourth", key: "quickReschedule4Min" },
];

// The row labels end with a colon (Settings label: control rows).
const group = (page: Page, name: string) => dialog(page).getByRole("group", { name: new RegExp(`^${name}:?$`) });
const field = (page: Page, name: string, unit: "Days" | "Hours" | "Minutes") => group(page, name).getByRole("spinbutton", { name: unit });

function row(dataDir: string, key: string): { value: number; at: number } {
  const db = new Database(join(dataDir, "data.sqlite"), { readonly: true });
  try {
    // A cleanup row is written at its first save; before that it reads as absent.
    const r = db.prepare("select value, updated_at as at from settings where key = ?").get(key) as { value: string; at: number } | undefined;
    if (r === undefined) return { value: Number.NaN, at: 0 };
    return { value: JSON.parse(r.value) as number, at: r.at };
  } finally {
    db.close();
  }
}

async function typeInTurn(page: Page, name: string, d: string, h: string, m: string) {
  await field(page, name, "Days").fill(d);
  await page.keyboard.press("Tab");
  await page.keyboard.type(h);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Tab");
  await page.keyboard.type(m);
}

for (const g of GROUPS) {
  test(`SC-011 ${g.legend}: days, hours and minutes in turn save once, 2 s after the last keystroke`, async () => {
    const dataDir = freshDataDir();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openSettings(page, "Alerts");
      const before = row(dataDir, g.key);
      await field(page, g.legend, "Days").focus();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
      // Hours and minutes are typed into fields cleared first, so the total is exactly 1 d 2 h 3 m.
      await field(page, g.legend, "Hours").fill("");
      await field(page, g.legend, "Minutes").fill("");
      await typeInTurn(page, g.legend, "1", "2", "3");
      // While moving between its fields, nothing was written; a Tab 1.5 s after typing restarted the wait.
      expect(row(dataDir, g.key)).toEqual(before);
      await page.waitForTimeout(2100);
      const after = row(dataDir, g.key);
      expect(after.value).toBe(24 * 60 + 2 * 60 + 3);
      expect(after.at).toBeGreaterThan(before.at);
      await page.waitForTimeout(500);
      expect(row(dataDir, g.key).at).toBe(after.at);
    } finally {
      await app.close();
    }
  });
}

test("SC-011 Tab out of the group and Enter save at once; closing Settings 300 ms after typing saves", async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVesta({ dataDir });
  try {
    await openSettings(page, "Alerts");
    const t = "Reschedule tolerance";
    await field(page, t, "Hours").fill("5");
    await field(page, t, "Minutes").focus();
    await page.waitForTimeout(100);
    // Still inside the group: nothing yet.
    expect(row(dataDir, "rescheduleToleranceMin").value).not.toBe(5 * 60 + Number(await field(page, t, "Days").inputValue()) * 1440);
    await group(page, "Re-blink interval").getByRole("spinbutton", { name: "Days" }).focus();
    await expect.poll(() => row(dataDir, "rescheduleToleranceMin").value, { timeout: 500 }).toBe(Number(await field(page, t, "Days").inputValue()) * 1440 + 300);
    await field(page, "First", "Hours").fill("7");
    await page.keyboard.press("Enter");
    await expect.poll(() => row(dataDir, "quickReschedule1Min").value, { timeout: 500 }).toBe(7 * 60);
    await field(page, "Second", "Hours").fill("9");
    await page.waitForTimeout(300);
    await closeSettings(page);
    await expect.poll(() => row(dataDir, "quickReschedule2Min").value, { timeout: 1000 }).toBe(9 * 60);
  } finally {
    await app.close();
  }
});

test("SC-011 the alert override: days, hours and minutes in turn save once, 2 s after the last keystroke; Enter saves at once", async () => {
  const dataDir = freshDataDir();
  const item = task({ titleMd: "Override me" });
  seedTasks(dataDir, [item]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    const card = taskCard(page, "Override me");
    await clickRevealed(card, card.getByRole("button", { name: "More actions" }));
    await page.getByRole("menuitem", { name: "Alert Period…" }).click();
    const pop = page.getByRole("dialog", { name: "Alert override" });
    await pop.getByRole("checkbox", { name: /Use the global default/ }).uncheck();
    await expect.poll(() => readTask(dataDir, item.id)?.alert_period_override_min).toBe(1440);
    const before = readTask(dataDir, item.id);
    const f = (unit: "Days" | "Hours" | "Minutes") => pop.getByRole("spinbutton", { name: unit });
    await f("Hours").fill("");
    await f("Minutes").fill("");
    await f("Days").fill("1");
    await page.keyboard.press("Tab");
    await page.keyboard.type("2");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Tab");
    await page.keyboard.type("3");
    // Nothing written while moving between its fields.
    expect(readTask(dataDir, item.id)?.alert_period_override_min).toBe(1440);
    expect(readTask(dataDir, item.id)?.updated_at).toBe(before?.updated_at);
    await page.waitForTimeout(2100);
    const after = readTask(dataDir, item.id);
    expect(after?.alert_period_override_min).toBe(1440 + 120 + 3);
    await page.waitForTimeout(500);
    expect(readTask(dataDir, item.id)?.updated_at).toBe(after?.updated_at);
    // Enter saves at once.
    await f("Days").fill("2");
    await page.keyboard.press("Enter");
    await expect.poll(() => readTask(dataDir, item.id)?.alert_period_override_min, { timeout: 500 }).toBe(2 * 1440 + 120 + 3);
  } finally {
    await app.close();
  }
});

const CLEANUPS = [
  { which: "archive", key: "archiveCleanupHours", typed: ["2", "3", "4"], hours: 2 * 8760 + 3 * 24 + 4 },
  { which: "trash", key: "trashCleanupHours", typed: ["1", "2", "3"], hours: 8760 + 2 * 24 + 3 },
] as const;

for (const c of CLEANUPS) {
  const cleanupField = (page: Page, name: "Years" | "Days" | "Hours") => dialog(page).getByTestId(`cleanup-${c.which}`).getByLabel(name, { exact: true });

  test(`SC-011 ${c.which} cleanup: years, days and hours in turn save once, 2 s after the last keystroke`, async () => {
    const dataDir = freshDataDir();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openSettings(page, "Data");
      const before = row(dataDir, c.key);
      await cleanupField(page, "Years").fill(c.typed[0]);
      await page.keyboard.press("Tab");
      await expect(cleanupField(page, "Days")).toBeFocused();
      await page.keyboard.type(c.typed[1]);
      await page.waitForTimeout(1500);
      await page.keyboard.press("Tab");
      await page.keyboard.type(c.typed[2]);
      // While moving between its fields, nothing was written.
      expect(row(dataDir, c.key)).toEqual(before);
      await page.waitForTimeout(2100);
      const after = row(dataDir, c.key);
      expect(after.value).toBe(c.hours);
      expect(after.at).toBeGreaterThan(before.at);
      await page.waitForTimeout(500);
      expect(row(dataDir, c.key).at).toBe(after.at);
      expect(await confirmRequests(app)).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test(`SC-011 ${c.which} cleanup: a longer time saves at once on a Tab out of the group, with no dialog`, async () => {
    const dataDir = freshDataDir();
    const { app, page } = await launchVesta({ dataDir });
    try {
      await openSettings(page, "Data");
      const before = row(dataDir, c.key);
      await cleanupField(page, "Years").fill(c.typed[0]);
      await cleanupField(page, "Hours").focus();
      await page.waitForTimeout(100);
      // Still inside the group: nothing yet.
      expect(row(dataDir, c.key)).toEqual(before);
      await page.keyboard.press("Tab");
      await expect.poll(() => row(dataDir, c.key).value, { timeout: 500 }).toBe(Number(c.typed[0]) * 8760 + (c.which === "trash" ? 30 * 24 : 0));
      expect(await confirmRequests(app)).toEqual([]);
    } finally {
      await app.close();
    }
  });
}

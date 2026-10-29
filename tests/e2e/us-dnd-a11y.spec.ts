/** 004 FR-012, FR-030, FR-031 (quickstart 21): accessible during a drag, in both themes; no animation with reduced motion. */
import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { reminder, seedReminders, seedTasks, staleTask, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { expectNoA11yViolations } from "./fixtures/axe";
import { dragTo, readTitles } from "./fixtures/drag";

async function setup() {
  const dataDir = freshDataDir();
  const now = Date.now();
  const p = task({ titleMd: "P", position: 2, alertOverrideMin: 14_400 });
  seedTasks(dataDir, [
    staleTask({ titleMd: "G1", createdAt: now - 3 * 86_400_000, position: 10 }),
    task({ titleMd: "A", position: 1, alertOverrideMin: 14_400 }),
    p,
    task({ titleMd: "S1", parentId: p.id, position: 1, alertOverrideMin: 14_400 }),
    staleTask({ titleMd: "H", createdAt: now - 2 * 86_400_000, position: 3, manuallyPositioned: true }),
  ]);
  seedReminders(dataDir, [reminder({ textMd: "R1", position: 1 })]);
  return launchVesta({ dataDir });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`004: no violations at rest and with each indicator shown, ${colorScheme} mode`, async () => {
    const { app, page } = await setup();
    try {
      await page.emulateMedia({ colorScheme });
      await expectNoA11yViolations(page, `${colorScheme}: at rest`);
      const shows: [string, Parameters<typeof dragTo>[2], string][] = [
        ["A", { row: taskCard(page, "H"), zone: "upper" }, "line-top"],
        ["A", { row: taskCard(page, "S1"), zone: "upper" }, "line-sub"],
        ["A", { row: taskCard(page, "P"), zone: "middle" }, "card"],
        ["H", { row: taskCard(page, "G1"), zone: "upper" }, "group"],
      ];
      for (const [title, target, kind] of shows) {
        expect(await dragTo(page, taskCard(page, title), target, { release: false })).toBe(kind);
        await expectNoA11yViolations(page, `${colorScheme}: ${kind} indicator`);
        await page.keyboard.press("Escape");
        await page.mouse.up();
      }
    } finally {
      await app.close();
    }
  });
}

test("004 FR-030: the grip says Drag to move; cards are described by the drag and keyboard hints", async () => {
  const { app, page } = await setup();
  try {
    await expect(taskCard(page, "A").locator(".grip")).toHaveAttribute("title", "Drag to move");
    // 007 FR-037: the keyboard hint names the current combinations, in words a screen reader can say.
    const mod = process.platform === "darwin" ? "Option" : "Alt";
    const hint = `Drag to move ${mod} Up arrow or ${mod} Down arrow moves it; ${mod} Left arrow or ${mod} Right arrow changes its level`;
    await expect(taskCard(page, "A")).toHaveAccessibleDescription(hint);
    await expect(page.locator("li[data-kind='rem']").first()).toHaveAccessibleDescription(hint);
  } finally {
    await app.close();
  }
});

test("004 FR-031: with reduced motion a drop shows no animation", async () => {
  const dataDir = freshDataDir();
  seedTasks(dataDir, [task({ titleMd: "A", position: 1 }), task({ titleMd: "B", position: 2 })]);
  const { app, page } = await launchVesta({ dataDir });
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" });
    await expect.poll(() => readTitles(page)).toEqual(["B", "A"]);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
    expect(running).toBe(0);
  } finally {
    await app.close();
  }
});

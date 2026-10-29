/** 003 FR-043, FR-044: failed saves for Reschedule, the override, and the alert ticks (T066). */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { blinkLog, recordBlinks, taskCard } from "./fixtures/alerts";
import { HOUR, readTask, tick } from "./fixtures/clock";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta, relaunch } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";

test("003 FR-043/FR-044: failed saves show 'Changes are not saved', keep the saved state and are logged; ticks still show the stale state and never blink twice", async () => {
  const dataDir = freshDataDir();
  const stale = task({ titleMd: "Already stale", position: 1, createdAt: Date.now() - 30 * HOUR });
  const fresh = task({ titleMd: "Fresh", position: 2 });
  seedTasks(dataDir, [stale, fresh]);
  let run = await launchVesta({ dataDir, env: { VESTA_FAULT: "save" } });
  try {
    await tick(run.page);
    // The tick could not save, but the stale state shows; no episode was played or recorded.
    await expect(taskCard(run.page, "Already stale")).toHaveClass(/\bstale\b/);
    expect(readTask(dataDir, stale.id)).toMatchObject({ stale_since: null, last_blink_at: null });

    const card = taskCard(run.page, "Already stale");
    await clickRevealed(card, card.getByRole("button", { name: "Reschedule" }));
    await expect(run.page.getByTestId("notification")).toContainText("Changes are not saved");
    await expect(card).toHaveClass(/\bstale\b/);

    const freshCard = taskCard(run.page, "Fresh");
    await clickRevealed(freshCard, freshCard.getByRole("button", { name: "More actions" }));
    await run.page.getByRole("menuitem", { name: "Alert Period…" }).click();
    // The save fails, so the checkbox stays at the saved state (ticked) and nothing is stored.
    await run.page.getByRole("dialog", { name: "Alert override" }).getByRole("checkbox").click();
    await expect(run.page.getByRole("dialog", { name: "Alert override" }).getByRole("checkbox")).toBeChecked();
    expect(readTask(dataDir, fresh.id)?.alert_period_override_min ?? null).toBeNull();
    await run.page.keyboard.press("Escape");

    const log = join(dataDir, "logs", "vesta-001.log");
    await expect.poll(() => existsSync(log)).toBe(true);
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const failed = (action: string) => lines.find((l) => l["event"] === "save.failed" && l["action"] === action);
    expect(failed("tasks:reschedule")?.["ids"]).toEqual([stale.id]);
    expect(failed("tasks:set-alert-override")?.["ids"]).toEqual([fresh.id]);
    expect(lines.some((l) => l["event"] === "alerts.tick-save-failed")).toBe(true);

    // Without the fault, exactly one pending episode plays and is recorded.
    run = await relaunch(run, { env: { VESTA_FAULT: "" } });
    await recordBlinks(run.page);
    await tick(run.page);
    await expect.poll(() => readTask(dataDir, stale.id)?.last_blink_at ?? null).not.toBeNull();
    await tick(run.page);
    expect((await blinkLog(run.page)).filter((b) => b.id === stale.id).length).toBeLessThanOrEqual(1);
    expect(readTask(dataDir, stale.id)?.first_blink_count).toBe(1);
  } finally {
    await run.app.close();
  }
});

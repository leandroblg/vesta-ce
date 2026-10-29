/** 004 FR-021 (quickstart 20): a failed move shows "Changes are not saved", keeps the saved order and is logged. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { seedTasks, task } from "./fixtures/seed";
import { taskCard } from "./fixtures/alerts";
import { dragTo, readTitles } from "./fixtures/drag";

test("004 FR-021: a drop and an Alt+Down that cannot be saved change nothing, show the notice and are logged", async () => {
  const dataDir = freshDataDir();
  const a = task({ titleMd: "A", position: 1 });
  const b = task({ titleMd: "B", position: 2 });
  seedTasks(dataDir, [a, b, task({ titleMd: "C", position: 3 })]);
  const { app, page } = await launchVesta({ dataDir, env: { VESTA_FAULT: "save" } });
  try {
    expect(await dragTo(page, taskCard(page, "B"), { row: taskCard(page, "A"), zone: "upper" })).toBe("line-top");
    await expect(page.getByTestId("notification")).toContainText("Changes are not saved");
    expect(await readTitles(page)).toEqual(["A", "B", "C"]);

    await taskCard(page, "A").getByRole("checkbox").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.getByTestId("notification")).toContainText("Changes are not saved");
    await page.waitForTimeout(200);
    expect(await readTitles(page)).toEqual(["A", "B", "C"]);

    const log = join(dataDir, "logs", "vesta-001.log");
    await expect.poll(() => existsSync(log)).toBe(true);
    const lines = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    const moves = lines.filter((l) => l["event"] === "save.failed" && l["action"] === "tasks:move");
    expect(moves.map((l) => l["ids"])).toEqual([[b.id], [a.id]]);
  } finally {
    await app.close();
  }
});

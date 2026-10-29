// 008 SC-001 and the A8 formatting criterion: export → import into an empty profile yields identical data, files
// and formatting (tasks T049; checklist round-trip-merge). "Identical" is snapshotDiff (research §12).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { snapshotDiff } from "../unit/fixtures/export-compare";
import { exportFolder, exportVia, importVia, notice, seedFullProfile, snapshotOf } from "./fixtures/export";
import { freshDataDir, launchVesta } from "./fixtures/launch";

test.describe("008 SC-001 — round trip into an empty profile", () => {
  test("every item, field, text, file and setting arrives identical", async () => {
    test.setTimeout(120_000);
    const source = freshDataDir();
    const { taskCount, reminderCount } = seedFullProfile(source);
    const folder = exportFolder();
    const a = await launchVesta({ dataDir: source });
    try {
      await exportVia(a.app, a.page, folder);
    } finally {
      await a.app.close();
    }
    const zip = join(folder, readdirSync(folder)[0] ?? "");
    const expected = snapshotOf(source);
    expect(expected.tasks).toHaveLength(taskCount);
    expect(expected.reminders).toHaveLength(reminderCount);
    expect(Object.keys(expected.files)).toHaveLength(2);

    const b = await launchVesta();
    try {
      expect(await importVia(b.app, b.page, zip)).toBe("merged");
      await expect(notice(b.page)).toContainText(String(taskCount + reminderCount));
      expect(snapshotDiff(expected, snapshotOf(b.dataDir))).toEqual([]);
    } finally {
      await b.app.close();
    }
    // After the restart (the offer ended on quit), still identical.
    expect(snapshotDiff(expected, snapshotOf(b.dataDir))).toEqual([]);
  });
});

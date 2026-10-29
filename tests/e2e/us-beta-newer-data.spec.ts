// 017 FR-015a (PRD Q263, Q267, Q269): an older build refuses data saved by a newer version and changes none of it.
// Tasks T024; quickstart.md §3.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickRevealed } from "./fixtures/hover";
import { freshDataDir, launchVesta } from "./fixtures/launch";
import { newReminderEditor, reminderSection } from "./fixtures/reminders";
import { SCHEMA_VERSION, seedAsset, seedTasksAtVersion, task, writeBackup } from "./fixtures/seed";
import { openSettings } from "./fixtures/settings";

const NEWER = "This data was saved by a newer version of Vesta. Open it with that version or a newer one.";
const REFUSED = "Export and import are not available while this data is from a newer version of Vesta.";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

/** The data itself: the database, the backups and the stored files (not the log or Chromium's session). */
function dataHashes(dataDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (rel: string) => {
    out[rel] = createHash("sha256").update(readFileSync(join(dataDir, rel))).digest("hex");
  };
  add("data.sqlite");
  for (const folder of ["backups", "assets"]) {
    if (!existsSync(join(dataDir, folder))) continue;
    for (const f of readdirSync(join(dataDir, folder))) if (!/-(wal|shm)$/.test(f)) add(join(folder, f));
  }
  return out;
}

test("017 FR-015a: data from a newer version is refused, shown as such, and left byte for byte as it was", async () => {
  test.setTimeout(90_000);
  const dataDir = freshDataDir();
  seedTasksAtVersion(dataDir, [task({ titleMd: "From the newer beta" })], SCHEMA_VERSION + 1);
  seedAsset(dataDir, PNG, "png", "image/png");
  writeBackup(dataDir, [task({ titleMd: "Backed up by the newer beta" })], Date.now() - 60_000);
  const before = dataHashes(dataDir);

  const { app, page } = await launchVesta({ dataDir });
  const notice = page.getByTestId("notification");
  try {
    await expect(notice).toContainText(NEWER);
    await expect(page.getByText("From the newer beta")).toHaveCount(0);

    // Every change fails as any failed save; closing that notice brings the newer-data notice back (Q269).
    await reminderSection(page).getByRole("button", { name: "New reminder…" }).click();
    await newReminderEditor(page).fill("Never saved");
    await newReminderEditor(page).press("Enter");
    await expect(notice).toContainText("Changes are not saved");
    await clickRevealed(notice, notice.getByRole("button", { name: "Close" }));
    await expect(notice).toContainText(NEWER);

    // Storing a file fails as a save, before anything is written (contracts/newer-data.md).
    const stored = await page.evaluate(async (bytes) => {
      const vesta = (window as unknown as { vesta: { assets: { importBytes: (i: unknown) => Promise<{ ok: boolean; error?: { code: string } }> } } }).vesta;
      return vesta.assets.importBytes({ name: "x.png", bytes: new Uint8Array(bytes), scope: "details" });
    }, [...PNG, 9]);
    expect(stored).toMatchObject({ ok: false, error: { code: "SAVE_FAILED" } });

    // Export and import say so at once; no dialog opens, since no test answer is set for one (Q269).
    await openSettings(page, "Data");
    await page.getByTestId("export").click();
    await expect(page.getByTestId("data-status")).toHaveText(REFUSED);
    await page.getByTestId("import").click();
    await expect(page.getByTestId("data-status")).toHaveText(REFUSED);
  } finally {
    await app.close();
  }

  expect(dataHashes(dataDir)).toEqual(before);
  const log = readdirSync(join(dataDir, "logs"))
    .map((f) => readFileSync(join(dataDir, "logs", f), "utf8"))
    .join("");
  expect(log).toContain("db.newer-schema");
  expect(log).toContain(`"dataVersion":${String(SCHEMA_VERSION + 1)}`);
  expect(log).toContain(`"latestVersion":${String(SCHEMA_VERSION)}`);
});

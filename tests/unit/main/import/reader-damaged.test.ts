// T054: every SC-003 variant gets its refusal and nothing is written (FR-021 to FR-023).
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toExportJson } from "../../../../src/domain/export/format";
import { openExport } from "../../../../src/main/import/reader";
import { tempDir } from "../../db/helpers";
import { DAMAGE_VARIANTS, EXPECTED_REFUSAL, writeDamaged } from "../../fixtures/damage";
import { writeZip } from "../../fixtures/zip";

const warned: unknown[] = [];
const log = { warn: (e: string, f?: unknown) => warned.push([e, f]), error: () => undefined, info: () => undefined };

describe("openExport: damaged and foreign files", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    mkdirSync(join(dir, "data", "assets"), { recursive: true });
    warned.length = 0;
  });
  afterEach(() => {
    cleanup();
  });

  it.each(DAMAGE_VARIANTS)("%s", async (variant) => {
    const zip = join(dir, `${variant}.zip`);
    writeDamaged(zip, variant);
    const result = await openExport(zip, { log });
    const expected = EXPECTED_REFUSAL[variant];
    if (expected === null) {
      expect(result.ok).toBe(true);
      if (result.ok) result.opened.close();
    } else {
      expect(result).toEqual({ ok: false, refusal: expected });
      expect(warned.some((w) => (w as unknown[])[0] === "import.refused")).toBe(true);
    }
    expect(readdirSync(join(dir, "data", "assets"))).toEqual([]);
    expect(existsSync(join(dir, "evil.txt"))).toBe(false);
  });

  it("refuses a data.json over the limit as too large, before reading it", async () => {
    const zip = join(dir, "big.zip");
    await writeZip(zip, { "data.json": toExportJson({ appVersion: "x", exportedAt: 1, tasks: [], reminders: [], settings: [], assets: [] }) });
    expect(await openExport(zip, { log, maxDataJsonBytes: 10 })).toEqual({ ok: false, refusal: { kind: "damaged", cause: "dataTooLarge", where: "data.json" } });
  });
});

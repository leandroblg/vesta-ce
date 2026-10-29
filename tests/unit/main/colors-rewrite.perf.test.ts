import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rewriteStoredColors } from "../../../src/main/db/colors-rewrite";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { upsertTasksTwoPass } from "../../../src/main/db/tasks-repo";
import { tempDir } from "../db/helpers";
import { mk } from "../domain/fixtures";
import { budget } from "../perf-budget";

describe("FR-015 one-time color rewrite, speed", () => {
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("plan Performance Goals: rewrites 1,000 colored tasks within 500 ms", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      mk({ titleMd: `Row ${String(i)} [c]{color="#d33"} ==m==`, detailsMd: `Details ${String(i)}\n\n- [x]{bg="#ffe066"} item\n- second` }),
    );
    upsertTasksTwoPass(db, rows);
    const t0 = performance.now();
    const result = rewriteStoredColors(db);
    const ms = performance.now() - t0;
    console.info(`[011 T044] rewrite of 1,000 tasks: ${ms.toFixed(0)} ms`);
    expect(result.tasks).toBe(1000);
    // 403 ms measured alone (research §22).
    expect(ms).toBeLessThan(budget(500));
  });
});

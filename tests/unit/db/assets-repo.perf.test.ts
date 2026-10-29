import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recomputeAssetTypes } from "../../../src/main/db/assets-repo";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { budget } from "../perf-budget";
import { tempDir } from "./helpers";

describe("M2 recomputeAssetTypes stays within the start budget (010 plan, Performance Goals)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    mkdirSync(join(dir, "assets"));
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("M2 recomputes 10,000 stored files well under the 2 s start budget", () => {
    const insert = db.prepare("insert into assets (sha256, ext, mime_type, size, created_at, removed_at) values (?, ?, ?, ?, ?, null)");
    db.transaction(() => {
      for (let i = 0; i < 10_000; i += 1) {
        const sha = i.toString(16).padStart(64, "0");
        insert.run(sha, "pdf", "text/html", 5, 1);
        writeFileSync(join(dir, "assets", `${sha}.pdf`), "%PDF-");
      }
    })();
    const t0 = performance.now();
    const result = recomputeAssetTypes(db, dir);
    const ms = performance.now() - t0;
    expect(result).toEqual({ count: 10_000, changed: 10_000 });
    expect(ms).toBeLessThan(budget(2_000));
    console.info(`M2 recomputeAssetTypes: 10,000 files in ${String(Math.round(ms))} ms`);
  }, 60_000);
});

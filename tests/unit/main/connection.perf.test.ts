import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { afterMigrate, openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { purgeExpired } from "../../../src/main/db/purge";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { makeTask, tempDir } from "../db/helpers";
import { budget } from "../perf-budget";

describe("L15 the database connection, speed (010 FR-024, research §6)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database | null = null;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    db?.close();
    db = null;
    cleanup();
  });

  it("L15 the post-purge maintenance stays under 200 ms with 1,000 tasks", () => {
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    afterMigrate(db);
    applyChangeSet(db, { upserts: Array.from({ length: 1_000 }, (_, i) => makeTask({ titleMd: `Task ${String(i)} ${randomBytes(8).toString("hex")}` })), removals: [] });
    const t0 = performance.now();
    purgeExpired(db, 2_000);
    expect(performance.now() - t0).toBeLessThan(budget(200));
  });
});

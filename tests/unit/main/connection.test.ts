import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterMigrate, openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { purgeExpired } from "../../../src/main/db/purge";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { makeTask, tempDir } from "../db/helpers";

const unix = process.platform !== "win32";

describe("L9/L15 the database connection (010 FR-023, FR-024, research §5, §6)", () => {
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

  const open = () => {
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    afterMigrate(db);
    return db;
  };

  it.skipIf(!unix)("L9 the database and its journal are owner-only", () => {
    const d = open();
    applyChangeSet(d, { upserts: [makeTask()], removals: [] });
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = join(dir, `data.sqlite${suffix}`);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });

  it("L15 secure deletion is on for the database and the search index", () => {
    const d = open();
    expect(d.pragma("secure_delete", { simple: true })).toBe(1);
    const config = d.prepare("select v from search_fts_config where k = 'secure-delete'").get() as { v: number } | undefined;
    expect(config?.v).toBe(1);
  });

  it("L15 incremental vacuum is enabled once and afterMigrate is a no-op the second time", () => {
    const d = open();
    expect(d.pragma("auto_vacuum", { simple: true })).toBe(2);
    const before = statSync(join(dir, "data.sqlite")).mtimeMs;
    afterMigrate(d);
    expect(d.pragma("auto_vacuum", { simple: true })).toBe(2);
    expect(statSync(join(dir, "data.sqlite")).mtimeMs).toBe(before);
  });

  it("L15 purged content is not found by a byte scan of the database files", () => {
    const d = open();
    const marker = randomBytes(16).toString("hex"); // 32 characters
    const task = makeTask({ titleMd: `Secret ${marker} title`, detailsMd: `body ${marker}` });
    applyChangeSet(d, { upserts: [task], removals: [] });
    d.pragma("wal_checkpoint(PASSIVE)");
    const files = () => ["", "-wal", "-shm"].map((s) => join(dir, `data.sqlite${s}`)).filter((p) => existsSync(p));
    const hits = () => files().filter((p) => readFileSync(p).includes(marker)).length;
    expect(hits()).toBeGreaterThan(0);
    // Permanent deletion as the Trash does it, then the purge with its maintenance step.
    applyChangeSet(d, { upserts: [], removals: [task.id] });
    purgeExpired(d, 2_000);
    expect(hits()).toBe(0);
  });
});

describe("openDatabase on a file that is not a database", () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("closes the connection it opened before throwing, so Windows can move the file aside", () => {
    const path = join(dir, "data.sqlite");
    writeFileSync(path, Buffer.alloc(4096, 7));
    const close = vi.spyOn(Database.prototype, "close");
    expect(() => openDatabase(path)).toThrow();
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => {
      renameSync(path, join(dir, "moved.sqlite"));
    }).not.toThrow();
  });
});

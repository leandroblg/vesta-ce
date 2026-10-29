// 005 FR-032a: the backup locks in the database, through the real backup, purge, import and restore.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { DAY_MS } from "../../../src/domain/cleanup";
import { importBytes } from "../../../src/main/assets/store";
import { writeBackup } from "../../../src/main/backup/backup";
import { getAsset, listAssetHashes } from "../../../src/main/db/assets-repo";
import { listLocks } from "../../../src/main/db/backup-locks-repo";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { purgeExpired } from "../../../src/main/db/purge";
import { applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { openWithRecovery } from "../../../src/main/startup/recover";
import { makeTask, tempDir } from "../db/helpers";

const quietLog = { fatal: () => undefined, error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined, trace: () => undefined };
const NOW = 100 * DAY_MS;
const LATEST = "backups/latest.sqlite";

describe("backup locks (005 FR-032a)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const store = () => ({ dir, db, clock: fixedClock(NOW) });
  const files = () => (existsSync(join(dir, "assets")) ? readdirSync(join(dir, "assets")).sort() : []);
  const add = (name: string, body: string) =>
    importBytes(store(), { name, bytes: Buffer.from(body), scope: "details" }).ref;
  const task = (detailsMd: string) => {
    const t = makeTask({ detailsMd });
    applyChangeSet(db, { upserts: [t], removals: [] });
    return t;
  };
  const drop = (id: string) => {
    const t = loadAll(db).find((x) => x.id === id);
    if (t) applyChangeSet(db, { upserts: [{ ...t, detailsMd: "" }], removals: [] });
  };
  const purge = () => purgeExpired(db, NOW, { dir, log: quietLog });

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("a valid backup records exactly its stored files", async () => {
    const a = add("a.txt", "a");
    const b = add("b.txt", "b");
    task(`[a](${a}) [a again](${a})`);
    task(`[b](${b})`);
    add("c.txt", "c"); // stored, but not referenced
    await writeBackup(db, dir, NOW, quietLog);
    expect(listLocks(db)).toEqual(
      expect.arrayContaining([
        { backup: LATEST, path: a },
        { backup: LATEST, path: b },
      ]),
    );
    expect(listLocks(db)).toHaveLength(2);
  });

  it("the purge tags a file a backup lists and deletes one no backup lists, file after row", async () => {
    const locked = add("locked.txt", "locked");
    const free = add("free.txt", "free");
    const t = task(`[l](${locked})`);
    await writeBackup(db, dir, NOW, quietLog);
    drop(t.id);
    purge();
    const lockedHash = locked.slice(7, 71);
    expect(getAsset(db, lockedHash)?.removedAt).toBe(NOW);
    expect(files()).toContain(locked.slice(7));
    expect(getAsset(db, free.slice(7, 71))).toBeNull();
    expect(files()).not.toContain(free.slice(7));
  });

  it("the next backup deletes tagged files no lock lists any more", async () => {
    const locked = add("locked.txt", "locked");
    const t = task(`[l](${locked})`);
    await writeBackup(db, dir, NOW, quietLog);
    drop(t.id);
    purge();
    expect(files()).toContain(locked.slice(7));
    await writeBackup(db, dir, NOW + 1, quietLog);
    expect(listAssetHashes(db)).toEqual([]);
    expect(files()).toEqual([]);
    expect(listLocks(db)).toEqual([]);
  });

  it("importing the same bytes again clears the tag", async () => {
    const locked = add("locked.txt", "locked");
    const t = task(`[l](${locked})`);
    await writeBackup(db, dir, NOW, quietLog);
    drop(t.id);
    purge();
    expect(getAsset(db, locked.slice(7, 71))?.removedAt).toBe(NOW);
    add("again.txt", "locked");
    expect(getAsset(db, locked.slice(7, 71))?.removedAt).toBeNull();
  });

  it("after a restore the locks are rebuilt and the stored files stay in assets/", async () => {
    const kept = add("kept.txt", "kept");
    task(`[k](${kept})`);
    await writeBackup(db, dir, NOW, quietLog);
    db.close();
    writeFileSync(join(dir, "data.sqlite"), "this is not a database");
    for (const suffix of ["-wal", "-shm"])
      if (existsSync(join(dir, `data.sqlite${suffix}`))) writeFileSync(join(dir, `data.sqlite${suffix}`), "");
    const r = await openWithRecovery({ dataDir: dir, now: NOW + 5, log: quietLog });
    db = r.db;
    expect(r.result.kind).toBe("restored");
    expect(files()).toEqual([kept.slice(7)]);
    expect(readdirSync(dir).some((n) => n.startsWith("recovered-") && existsSync(join(dir, n, "assets")))).toBe(false);
    expect(listLocks(db)).toEqual([{ backup: LATEST, path: kept }]);
  });

  it("a crash between the row deletion and the unlink leaves only a file, which the next purge removes", () => {
    const free = add("free.txt", "free");
    initFaults(false);
    process.env["VESTA_FAULT"] = "asset-unlink";
    expect(() => purge()).toThrow();
    expect(getAsset(db, free.slice(7, 71))).toBeNull();
    expect(files()).toEqual([free.slice(7)]);
    delete process.env["VESTA_FAULT"];
    purge();
    expect(files()).toEqual([]);
  });
});

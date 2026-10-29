import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { SaveFailedError, applyChangeSet } from "../../../src/main/db/tasks-repo";
import { makeTask, tempDir } from "./helpers";

describe("tasks_one_level trigger (FR-015)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("rejects inserting a subtask under a subtask", () => {
    const top = makeTask();
    const sub = makeTask({ parentId: top.id });
    applyChangeSet(db, { upserts: [top, sub], removals: [] });
    expect(() => {
      applyChangeSet(db, { upserts: [makeTask({ parentId: sub.id })], removals: [] });
    }).toThrow(SaveFailedError);
  });

  it("rejects moving a subtask under another subtask", () => {
    const top = makeTask();
    const sub = makeTask({ parentId: top.id });
    const other = makeTask({ parentId: top.id });
    applyChangeSet(db, { upserts: [top, sub, other], removals: [] });
    expect(() => {
      applyChangeSet(db, { upserts: [{ ...other, parentId: sub.id }], removals: [] });
    }).toThrow(/one_level|subtask/);
  });
});

// T017: the index stays in step with every write path, in the same transaction (006 FR-025, research §4).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "../../../src/domain/task";
import { fold } from "../../../src/domain/search/fold";
import { searchableText } from "../../../src/domain/search/searchable-text";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { purgeExpired } from "../../../src/main/db/purge";
import { applyReminderChangeSet } from "../../../src/main/db/reminders-repo";
import { SaveFailedError, applyChangeSet } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { makeReminder, makeTask, tempDir } from "./helpers";

interface Doc {
  kind: string;
  item_id: string;
  title_plain: string;
  body_plain: string;
  title_key: string;
  body_key: string;
}

const DAY = 86_400_000;

function doc(db: Database.Database, id: string): Doc | undefined {
  return db.prepare("select kind, item_id, title_plain, body_plain, title_key, body_key from search_docs where item_id = ?").get(id) as Doc | undefined;
}

/** The FTS5 index finds the row by a trigram of its key. */
function ftsFinds(db: Database.Database, id: string, needle: string): boolean {
  const q = `"${needle.replace(/"/g, '""')}"`;
  return (
    db
      .prepare("select d.item_id from search_fts f join search_docs d on d.rowid = f.rowid where search_fts match ?")
      .pluck()
      .all(q) as string[]
  ).includes(id);
}

function expectInStep(db: Database.Database, t: Task): void {
  const title = searchableText(t.titleMd, "title");
  const body = searchableText(t.detailsMd, "details");
  expect(doc(db, t.id)).toEqual({
    kind: "task",
    item_id: t.id,
    title_plain: title,
    body_plain: body,
    title_key: fold(title, { matchCase: false }).folded,
    body_key: fold(body, { matchCase: false }).folded,
  });
}

describe("search index sync", () => {
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
    delete process.env["VESTA_FAULT"];
    initFaults(true);
    cleanup();
  });

  it("indexes a created task and subtask", () => {
    const p = makeTask({ titleMd: "**Renew** passport", detailsMd: "Bring the *old* one" });
    const s = makeTask({ titleMd: "Photos", parentId: p.id });
    applyChangeSet(db, { upserts: [p, s], removals: [] });
    expectInStep(db, p);
    expectInStep(db, s);
    expect(ftsFinds(db, p.id, "sspor")).toBe(true);
    expect(ftsFinds(db, p.id, "old one")).toBe(true);
  });

  it("follows title and details edits", () => {
    const t = makeTask({ titleMd: "Old title" });
    applyChangeSet(db, { upserts: [t], removals: [] });
    const edited = { ...t, titleMd: "New *title*", updatedAt: t.updatedAt + 1 };
    applyChangeSet(db, { upserts: [edited], removals: [] });
    expectInStep(db, edited);
    const withDetails = { ...edited, detailsMd: "Invoice 2291", updatedAt: edited.updatedAt + 1 };
    applyChangeSet(db, { upserts: [withDetails], removals: [] });
    expectInStep(db, withDetails);
    expect(ftsFinds(db, t.id, "old title")).toBe(false);
    expect(ftsFinds(db, t.id, "2291")).toBe(true);
  });

  it("keeps the row through done, delete, restore, undo and move (status is not indexed)", () => {
    const p = makeTask({ titleMd: "Parent" });
    const t = makeTask({ titleMd: "Mover" });
    applyChangeSet(db, { upserts: [p, t], removals: [] });
    const steps: Task[] = [
      { ...t, doneAt: 500 },
      { ...t, doneAt: null },
      { ...t, deletedAt: 600 },
      { ...t, deletedAt: null },
      { ...t, parentId: p.id, position: 1 },
    ];
    for (const step of steps) {
      applyChangeSet(db, { upserts: [step], removals: [] });
      expectInStep(db, step);
    }
  });

  it("removes the row on permanent delete and on the Trash purge", () => {
    const a = makeTask({ titleMd: "Gone" });
    const b = makeTask({ titleMd: "Expired", deletedAt: 1 });
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    applyChangeSet(db, { upserts: [], removals: [a.id] });
    expect(doc(db, a.id)).toBeUndefined();
    purgeExpired(db, 31 * DAY + 10);
    expect(doc(db, b.id)).toBeUndefined();
    expect(ftsFinds(db, b.id, "expired")).toBe(false);
  });

  it("indexes reminders through create, edit, done, delete, restore, permanent delete and purge", () => {
    const r = makeReminder({ textMd: "Call the bank before **Friday**" });
    applyReminderChangeSet(db, { upserts: [r], removals: [], sectionCollapsed: null }, 1);
    const row = () => doc(db, r.id);
    expect(row()).toMatchObject({ kind: "reminder", title_plain: "Call the bank before Friday", body_plain: "", body_key: "" });
    const edited = { ...r, textMd: "Call the bank on Monday" };
    applyReminderChangeSet(db, { upserts: [edited], removals: [], sectionCollapsed: null }, 2);
    expect(row()?.title_key).toBe("call the bank on monday");
    for (const step of [{ ...edited, doneAt: 5 }, { ...edited, doneAt: null }, { ...edited, deletedAt: 6 }, { ...edited, deletedAt: null }]) {
      applyReminderChangeSet(db, { upserts: [step], removals: [], sectionCollapsed: null }, 3);
      expect(row()?.title_plain).toBe("Call the bank on Monday");
    }
    applyReminderChangeSet(db, { upserts: [], removals: [r.id], sectionCollapsed: null }, 4);
    expect(row()).toBeUndefined();
    const old = makeReminder({ textMd: "Old", deletedAt: 1 });
    applyReminderChangeSet(db, { upserts: [old], removals: [], sectionCollapsed: null }, 5);
    purgeExpired(db, 31 * DAY + 10);
    expect(doc(db, old.id)).toBeUndefined();
  });

  it("does not re-extract when the markdown is unchanged (the WHEN guard)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => makeTask({ titleMd: `Task ${String(i)}`, detailsMd: "some **details**" }));
    applyChangeSet(db, { upserts: rows, removals: [] });
    let calls = 0;
    db.function("vesta_search_plain", { deterministic: true }, (md: unknown, scope: unknown) => {
      calls += 1;
      return searchableText(typeof md === "string" ? md : "", scope === "title" ? "title" : "details");
    });
    // An alert tick: every row upserted with new alert fields and the same markdown.
    applyChangeSet(db, { upserts: rows.map((t) => ({ ...t, lastBlinkAt: 999, staleSince: 900 })), removals: [] });
    expect(calls).toBe(0);
  });

  it("marks details over 100,000 characters pending instead of extracting them (T019)", () => {
    const big = `start ${"x".repeat(100_001)} end`;
    const t = makeTask({ titleMd: "**Big** one", detailsMd: big });
    let detailCalls = 0;
    db.function("vesta_search_plain", { deterministic: true }, (md: unknown, scope: unknown) => {
      if (scope === "details") detailCalls += 1;
      return searchableText(typeof md === "string" ? md : "", scope === "title" ? "title" : "details");
    });
    applyChangeSet(db, { upserts: [t], removals: [] });
    expect(detailCalls).toBe(0);
    expect(db.prepare("select title_plain, body_plain, body_key, pending from search_docs where item_id = ?").get(t.id)).toEqual({
      title_plain: "Big one",
      body_plain: "",
      body_key: "",
      pending: 1,
    });
    const small = { ...t, detailsMd: "short again" };
    applyChangeSet(db, { upserts: [small], removals: [] });
    expect(db.prepare("select body_plain, pending from search_docs where item_id = ?").get(t.id)).toEqual({ body_plain: "short again", pending: 0 });
  });

  it("leaves the index unchanged when the action fails (same transaction)", () => {
    const t = makeTask({ titleMd: "Before" });
    applyChangeSet(db, { upserts: [t], removals: [] });
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    expect(() => {
      applyChangeSet(db, { upserts: [{ ...t, titleMd: "After" }], removals: [] });
    }).toThrow(SaveFailedError);
    expectInStep(db, t);
  });
});

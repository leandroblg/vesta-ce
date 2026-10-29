// T020: the background fill indexes missing and pending rows (006 research §2, §4; data-model "Background fill").
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { MIGRATIONS, migrate } from "../../../src/main/db/migrate";
import { isIndexPending, writeExtracted, nextUnindexed } from "../../../src/main/db/search-repo";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { extractItem, inProcessExtractor, type Extractor } from "../../../src/main/search/extract";
import { createFill } from "../../../src/main/search/fill";
import { makeReminder, makeTask, tempDir } from "./helpers";
import { searchDataSet } from "./search-data";

const docs = (db: Database.Database) => db.prepare("select count(*) from search_docs").pluck().get() as number;
const pendingRows = (db: Database.Database) => db.prepare("select count(*) from search_docs where pending = 1").pluck().get() as number;
const body = (db: Database.Database, id: string) =>
  db.prepare("select body_plain, pending from search_docs where item_id = ?").get(id) as { body_plain: string; pending: number } | undefined;

describe("search background fill", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    log.error.mockClear();
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  /** A v4 database with rows written before the search tables existed, then migrated. */
  function migratedWith(tasks: ReturnType<typeof makeTask>[], reminders: ReturnType<typeof makeReminder>[] = []): void {
    migrate(db, MIGRATIONS.filter((m) => m.version <= 4));
    // Only the columns a v4 database has; later migrations add the rest (015's reschedule_for_min, for one).
    const cols = (db.prepare("pragma table_info(tasks)").all() as { name: string }[]).map((c) => c.name);
    const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const insert = db.prepare(`insert into tasks (${cols.join(", ")}) values (${cols.map((c) => `@${c}`).join(", ")})`);
    for (const t of tasks) {
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(t)) if (cols.includes(snake(k))) row[snake(k)] = typeof v === "boolean" ? Number(v) : v;
      row["alert_period_override_min"] = t.alertOverrideMin;
      insert.run(row);
    }
    // 018: likewise only the reminders' v4 columns (kept_done_at comes with migration 12).
    const insertReminder = db.prepare(
      "insert into reminders (id, text_md, position, created_at, updated_at, done_at, deleted_at, prev_sibling_id, next_sibling_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const r of reminders) insertReminder.run(r.id, r.textMd, r.position, r.createdAt, r.updatedAt, r.doneAt, r.deletedAt, r.prevSiblingId, r.nextSiblingId);
    migrate(db);
  }

  it("indexes every task and reminder without a row, then reports once that nothing is pending", async () => {
    const tasks = Array.from({ length: 120 }, (_, i) => makeTask({ titleMd: `Task ${String(i)}`, detailsMd: `about **thing ${String(i)}**` }));
    const reminders = [makeReminder({ textMd: "Call the bank" })];
    migratedWith(tasks, reminders);
    expect(docs(db)).toBe(0);
    expect(isIndexPending(db)).toBe(true);
    const onIndexed = vi.fn();
    const batches: number[] = [];
    const extractor: Extractor = (items) => {
      batches.push(items.length);
      return inProcessExtractor(items);
    };
    const fill = createFill(() => db, extractor, onIndexed, log);
    fill.start();
    await fill.idle();
    expect(docs(db)).toBe(121);
    expect(batches.every((n) => n <= 50)).toBe(true);
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(isIndexPending(db)).toBe(false);
    expect(onIndexed).toHaveBeenCalledTimes(1);
    expect(body(db, tasks[7]?.id ?? "")).toEqual({ body_plain: "about thing 7", pending: 0 });
  });

  it("does nothing, and reports nothing, when the index is complete", async () => {
    migrate(db);
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "Indexed by its trigger" })], removals: [] });
    const extractor = vi.fn(inProcessExtractor);
    const onIndexed = vi.fn();
    const fill = createFill(() => db, extractor, onIndexed, log);
    fill.start();
    await fill.idle();
    expect(extractor).not.toHaveBeenCalled();
    expect(onIndexed).not.toHaveBeenCalled();
  });

  it("fills a pending 1,000,000-character details in full, after kick()", async () => {
    migrate(db);
    // Realistic content: short paragraphs. (One 1,000,000-character paragraph full of emphasis parses far
    // slower; it still runs off the main thread in production, research §2.)
    const big = `${"A paragraph with **bold**, a [link](https://x.example) and `code`.\n\n".repeat(16_000)}needle`.slice(-1_000_000);
    const t = makeTask({ titleMd: "Big", detailsMd: big });
    applyChangeSet(db, { upserts: [t], removals: [] });
    expect(pendingRows(db)).toBe(1);
    const onIndexed = vi.fn();
    const fill = createFill(() => db, inProcessExtractor, onIndexed, log);
    fill.kick();
    await fill.idle();
    const row = body(db, t.id);
    expect(row?.pending).toBe(0);
    expect(row?.body_plain.endsWith("needle")).toBe(true);
    expect(onIndexed).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("drops a result whose markdown changed while it was being extracted, and extracts it again", async () => {
    migrate(db);
    const t = makeTask({ titleMd: "Moving", detailsMd: "x".repeat(100_001) });
    applyChangeSet(db, { upserts: [t], removals: [] });
    let first = true;
    const extractor: Extractor = async (items) => {
      const out = await inProcessExtractor(items);
      if (first) {
        first = false;
        // An edit lands while the worker is busy: still large, so still pending.
        applyChangeSet(db, { upserts: [{ ...t, detailsMd: `${"y".repeat(100_001)} final` }], removals: [] });
      }
      return out;
    };
    const fill = createFill(() => db, extractor, vi.fn(), log);
    fill.kick();
    await fill.idle();
    expect(body(db, t.id)?.body_plain.endsWith("final")).toBe(true);
    expect(body(db, t.id)?.pending).toBe(0);
  });

  it("writes a skipped item's row only if the current markdown matches what was extracted", () => {
    migrate(db);
    const t = makeTask({ titleMd: "A", detailsMd: "x".repeat(100_001) });
    applyChangeSet(db, { upserts: [t], removals: [] });
    const [item] = nextUnindexed(db, 50);
    if (item === undefined) throw new Error("expected a pending item");
    const stale = { item: { ...item, detailsMd: "old text" }, ex: extractItem({ ...item, detailsMd: "old text" }) };
    expect(writeExtracted(db, [stale])).toBe(0);
    expect(writeExtracted(db, [{ item, ex: extractItem(item) }])).toBe(1);
  });

  it("logs and stops when extraction fails, and retries on the next kick", async () => {
    migratedWith([makeTask({ titleMd: "One" })]);
    let fail = true;
    const extractor: Extractor = (items) => (fail ? Promise.reject(new Error("worker died")) : inProcessExtractor(items));
    const fill = createFill(() => db, extractor, vi.fn(), log);
    fill.start();
    await fill.idle();
    expect(log.error).toHaveBeenCalledWith("search.fill-failed", expect.objectContaining({ message: "worker died" }));
    expect(isIndexPending(db)).toBe(true);
    fail = false;
    fill.kick();
    await fill.idle();
    expect(isIndexPending(db)).toBe(false);
  });

  it("resumes an interrupted fill at the next start", async () => {
    migratedWith(Array.from({ length: 80 }, (_, i) => makeTask({ titleMd: `T${String(i)}` })));
    const one = nextUnindexed(db, 50);
    writeExtracted(
      db,
      one.map((item) => ({ item, ex: extractItem(item) })),
    );
    expect(docs(db)).toBe(50);
    const fill = createFill(() => db, inProcessExtractor, vi.fn(), log);
    fill.start();
    await fill.idle();
    expect(docs(db)).toBe(80);
  });

  // The total time is measured with the real worker pool in performance.spec.ts (T048): extraction runs on up
  // to 4 threads there. Here, in one thread, the test checks main's share: each batch written in at most 60 ms.
  it("fills the research §5 data set, writing each batch in at most 60 ms", async () => {
    const { tasks, reminders } = searchDataSet();
    migratedWith(tasks, reminders);
    const writes: number[] = [];
    const t0 = performance.now();
    const fill = createFill(() => db, inProcessExtractor, vi.fn(), log, { onBatchWritten: (ms) => writes.push(ms) });
    fill.start();
    await fill.idle();
    const total = performance.now() - t0;
    expect(docs(db)).toBe(tasks.length + reminders.length);
    expect(Math.max(...writes)).toBeLessThanOrEqual(60);
    expect(total).toBeGreaterThan(0);
  }, 60_000);
});

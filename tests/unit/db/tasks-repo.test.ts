import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { SaveFailedError, applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { makeTask, tempDir } from "./helpers";

describe("tasks repository", () => {
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
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  it("writes upserts and loads every row back as Task", () => {
    const parent = makeTask({ collapsed: true });
    const child = makeTask({ parentId: parent.id, doneAt: 5, leftWithId: parent.id, prevSiblingId: "p", nextSiblingId: "n" });
    applyChangeSet(db, { upserts: [parent, child], removals: [] });
    const rows = loadAll(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === parent.id)).toEqual(parent);
    expect(rows.find((r) => r.id === child.id)).toEqual(child);
  });

  it("round-trips details: empty, multi-line and 1 MB (005 FR-009)", () => {
    const empty = makeTask({ detailsMd: "" });
    const multi = makeTask({ detailsMd: "# Notes\n\n- [ ] one\n- [x] two\n\n```js\nlet a = 1;\n```\n" });
    const big = makeTask({ detailsMd: "x".repeat(1_000_000) });
    applyChangeSet(db, { upserts: [empty, multi, big], removals: [] });
    const rows = loadAll(db);
    for (const t of [empty, multi, big]) expect(rows.find((r) => r.id === t.id)?.detailsMd).toBe(t.detailsMd);
    applyChangeSet(db, { upserts: [{ ...multi, detailsMd: "changed" }], removals: [] });
    expect(loadAll(db).find((r) => r.id === multi.id)?.detailsMd).toBe("changed");
  });

  it("round-trips every alert field (003 FR-041)", () => {
    const plain = makeTask();
    const stale = makeTask({
      alertOverrideMin: 10_080,
      staleBaseAt: 4000,
      staleSince: 5000,
      wasStale: true,
      lastBlinkAt: 6000,
      firstBlinkCount: 3,
      manuallyPositioned: true,
      lastSignalAt: 7000,
    });
    const sub = makeTask({ parentId: stale.id, staleSince: 8000, wasStale: true, firstBlinkCount: 1 });
    applyChangeSet(db, { upserts: [plain, stale, sub], removals: [] });
    const rows = loadAll(db);
    expect(rows.find((r) => r.id === plain.id)).toEqual(plain);
    expect(rows.find((r) => r.id === stale.id)).toEqual(stale);
    expect(rows.find((r) => r.id === sub.id)).toEqual(sub);
    const raw = db.prepare("select was_stale, manually_positioned from tasks where id = ?").get(stale.id);
    expect(raw).toEqual({ was_stale: 1, manually_positioned: 1 });
  });

  it("015: round-trips rescheduleForMin, null and a quick duration", () => {
    const tolerance = makeTask({ rescheduleForMin: null });
    const quick = makeTask({ rescheduleForMin: 120 });
    applyChangeSet(db, { upserts: [tolerance, quick], removals: [] });
    const byId = new Map(loadAll(db).map((t) => [t.id, t]));
    expect(byId.get(tolerance.id)?.rescheduleForMin).toBeNull();
    expect(byId.get(quick.id)?.rescheduleForMin).toBe(120);
  });

  it("updates existing rows and applies removals in the same transaction", () => {
    const a = makeTask();
    const b = makeTask();
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    applyChangeSet(db, { upserts: [{ ...a, titleMd: "changed", updatedAt: 2000 }], removals: [b.id] });
    expect(loadAll(db)).toEqual([{ ...a, titleMd: "changed", updatedAt: 2000 }]);
  });

  it("rolls back everything when a write fails midway (FR-040a)", () => {
    const parent = makeTask();
    applyChangeSet(db, { upserts: [parent], removals: [] });
    const ok = makeTask();
    const nested = makeTask({ parentId: makeTask().id }); // parent missing: FK fails
    expect(() => {
      applyChangeSet(db, { upserts: [ok, nested], removals: [parent.id] });
    }).toThrow(SaveFailedError);
    expect(loadAll(db)).toEqual([parent]);
  });

  it("forced save fault rolls back and throws SaveFailedError (VESTA_FAULT=save)", () => {
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    const a = makeTask();
    expect(() => {
      applyChangeSet(db, { upserts: [a], removals: [] });
    }).toThrow(SaveFailedError);
    delete process.env["VESTA_FAULT"];
    expect(loadAll(db)).toEqual([]);
  });

  it("stores exactly the updatedAt it is given (renumbering never touches it)", () => {
    const a = makeTask({ updatedAt: 1234 });
    applyChangeSet(db, { upserts: [a], removals: [] });
    applyChangeSet(db, { upserts: [{ ...a, position: 99 }], removals: [] });
    expect(loadAll(db)[0]).toMatchObject({ position: 99, updatedAt: 1234 });
  });

  it("stores and loads markdown titles byte for byte (constitution III)", () => {
    const title = 'Prepare **quarterly** [report]{color="#2f6fb0" .underline} ==R$ 257,25== 🦷 `code`';
    const a = makeTask({ titleMd: title });
    applyChangeSet(db, { upserts: [a], removals: [] });
    expect(loadAll(db)[0]?.titleMd).toBe(title);
  });

  it("rejects a done-and-deleted row (CHECK) as a failed save", () => {
    expect(() => {
      applyChangeSet(db, { upserts: [makeTask({ doneAt: 1, deletedAt: 1 })], removals: [] });
    }).toThrow(SaveFailedError);
  });

  it("004: a demotion with carried subtasks commits in one transaction, one level deep", () => {
    const p = makeTask({ position: 1 });
    const x = makeTask({ position: 2 });
    const x1 = makeTask({ parentId: x.id, position: 1 });
    const x2 = makeTask({ parentId: x.id, position: 2 });
    applyChangeSet(db, { upserts: [p, x, x1, x2], removals: [] });
    applyChangeSet(db, {
      upserts: [
        { ...x, parentId: p.id, position: 1 },
        { ...x1, parentId: p.id, position: 2 },
        { ...x2, parentId: p.id, position: 3 },
      ],
      removals: [],
    });
    const rows = loadAll(db);
    expect(rows.filter((t) => t.parentId === p.id).map((t) => t.id).sort()).toEqual([x.id, x1.id, x2.id].sort());
    expect(rows.some((t) => t.parentId === x.id)).toBe(false);
  });

  it("004: a ChangeSet that would nest two levels is refused by the 001 trigger, and nothing of it is saved", () => {
    const p = makeTask({ position: 1 });
    const x = makeTask({ position: 2 });
    const x1 = makeTask({ parentId: x.id, position: 1 });
    applyChangeSet(db, { upserts: [p, x, x1], removals: [] });
    const deep = makeTask({ parentId: x1.id, position: 1 });
    expect(() => {
      applyChangeSet(db, { upserts: [{ ...x, parentId: p.id }, deep], removals: [] });
    }).toThrow(SaveFailedError);
    const rows = loadAll(db);
    expect(rows.find((t) => t.id === x.id)?.parentId).toBeNull();
    expect(rows.some((t) => t.id === deep.id)).toBe(false);
  });
});

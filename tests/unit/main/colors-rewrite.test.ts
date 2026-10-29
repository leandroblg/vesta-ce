// 011 FR-015 (US2-14, research §13): the one-time rewrite of stored colors to 8 digits.
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReminderChangeSet } from "../../../src/domain/reminder";
import { runColorRewrite, rewriteStoredColors } from "../../../src/main/db/colors-rewrite";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { applyReminderChangeSet } from "../../../src/main/db/reminders-repo";
import { loadColorsRewritten } from "../../../src/main/db/settings-repo";
import { upsertTasksTwoPass } from "../../../src/main/db/tasks-repo";
import { tempDir } from "../db/helpers";
import { mk, mkReminder } from "../domain/fixtures";

describe("FR-015 one-time color rewrite", () => {
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

  const row = (table: string, id: string) => db.prepare(`select * from ${table} where id = ?`).get(id) as Record<string, unknown>;
  const ftsCount = (word: string) =>
    (db.prepare("select count(*) as n from search_fts where search_fts match ?").get(`"${word}"`) as { n: number }).n;

  it("FR-015 rewrites spans in titles, details and reminders; leaves updated_at, untouched rows and search as they were", () => {
    const a = mk({ titleMd: 'Renew [passport]{color="#d33"}', detailsMd: '[x]{bg="#ffe066"}\n\n```\n[y]{color="#d33"}\n```', updatedAt: 111 });
    const b = mk({ titleMd: "Plain title", detailsMd: "", updatedAt: 222 });
    const r = mkReminder({ textMd: 'Call [bank]{bg="#abc"}', updatedAt: 333 });
    upsertTasksTwoPass(db, [a, b]);
    applyReminderChangeSet(db, { ...emptyReminderChangeSet(), upserts: [r] }, 1);
    const before = ftsCount("passport");

    const result = rewriteStoredColors(db);

    expect(result).toEqual({ tasks: 1, reminders: 1 });
    expect(row("tasks", a.id)["title_md"]).toBe('Renew [passport]{color="#dd3333ff"}');
    expect(row("tasks", a.id)["details_md"]).toBe('[x]{bg="#ffe066ff"}\n\n```\n[y]{color="#d33"}\n```');
    expect(row("tasks", a.id)["updated_at"]).toBe(111);
    expect(row("tasks", b.id)["title_md"]).toBe("Plain title");
    expect(row("tasks", b.id)["updated_at"]).toBe(222);
    expect(row("reminders", r.id)["text_md"]).toBe('Call [bank]{bg="#aabbccff"}');
    expect(row("reminders", r.id)["updated_at"]).toBe(333);
    expect(ftsCount("passport")).toBe(before);
    expect(rewriteStoredColors(db)).toEqual({ tasks: 0, reminders: 0 });
  });

  it("FR-015 runs in one transaction: a failure rolls everything back", () => {
    const a = mk({ titleMd: '[a]{color="#d33"}' });
    const b = mk({ titleMd: '[b]{color="#d33"}' });
    upsertTasksTwoPass(db, [a, b]);
    db.exec(`create trigger fail_b before update on tasks when new.id = '${b.id}' begin select raise(abort, 'boom'); end`);
    expect(() => rewriteStoredColors(db)).toThrow("boom");
    expect(row("tasks", a.id)["title_md"]).toBe('[a]{color="#d33"}');
  });

  it("FR-015 the start step runs once, only when the folder is writable, and retries after a failure", () => {
    const a = mk({ titleMd: '[a]{color="#d33"}' });
    upsertTasksTwoPass(db, [a]);
    const log = { info: vi.fn(), error: vi.fn() };

    runColorRewrite(db, { writable: false, now: 5, log });
    expect(loadColorsRewritten(db)).toBe(false);
    expect(row("tasks", a.id)["title_md"]).toBe('[a]{color="#d33"}');

    db.exec(`create trigger fail_a before update on tasks begin select raise(abort, 'boom'); end`);
    runColorRewrite(db, { writable: true, now: 5, log });
    expect(log.error).toHaveBeenCalledWith("markdown.colors-rewrite-failed", { message: "boom" });
    expect(loadColorsRewritten(db)).toBe(false);

    db.exec("drop trigger fail_a");
    runColorRewrite(db, { writable: true, now: 6, log });
    expect(loadColorsRewritten(db)).toBe(true);
    expect(row("tasks", a.id)["title_md"]).toBe('[a]{color="#dd3333ff"}');
    expect(log.info).toHaveBeenCalledWith("markdown.colors-rewritten", expect.objectContaining({ tasks: 1, reminders: 0 }));
  });

  it("plan Performance Goals: rewrites 1,000 colored tasks (target 500 ms alone; under 1.5 s with the suite in parallel)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      mk({ titleMd: `Row ${String(i)} [c]{color="#d33"} ==m==`, detailsMd: `Details ${String(i)}\n\n- [x]{bg="#ffe066"} item\n- second` }),
    );
    upsertTasksTwoPass(db, rows);
    const t0 = performance.now();
    const result = rewriteStoredColors(db);
    const ms = performance.now() - t0;
    console.info(`[011 T044] rewrite of 1,000 tasks: ${ms.toFixed(0)} ms`);
    expect(result.tasks).toBe(1000);
    // 403 ms measured alone (research §22); the parallel suite slows it, so this guards against regressions only.
    expect(ms).toBeLessThan(1500);
  });
});

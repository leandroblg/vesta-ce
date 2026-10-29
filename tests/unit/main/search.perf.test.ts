// T026: search:query stays within 50 ms at p95 in main on the research §5 data set (006 research §5).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { applyReminderChangeSet } from "../../../src/main/db/reminders-repo";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { runSearchQuery } from "../../../src/main/search/query";
import type { SearchQuery } from "../../../src/shared/ipc-contract";
import { tempDir } from "../db/helpers";
import { budget } from "../perf-budget";
import { searchDataSet } from "../db/search-data";

const RUNS = 50;
const BUDGET_MS = budget(50);

describe("search:query performance (research §5 data set)", () => {
  let db: Database.Database;
  let cleanup: () => void;
  const log = { error: vi.fn() };

  beforeAll(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const { tasks, reminders } = searchDataSet();
    applyChangeSet(db, { upserts: tasks, removals: [] });
    applyReminderChangeSet(db, { upserts: reminders, removals: [], sectionCollapsed: null }, 1);
  }, 120_000);
  afterAll(() => {
    db.close();
    cleanup();
  });

  const cases: [string, Partial<SearchQuery>][] = [
    ["r", {}],
    ["re", {}],
    ["report", {}],
    ["quarterly report notes", {}],
    ["notes about", { exactPhrase: true }],
    ["Café", { matchCase: true }],
    ["invoice", { includeArchiveTrash: true }],
    ["e", { includeArchiveTrash: true }],
  ];

  for (const [text, extra] of cases) {
    it(`"${text}" ${JSON.stringify(extra)} ≤ ${String(BUDGET_MS)} ms at p95`, () => {
      const q: SearchQuery = { seq: 1, text, matchCase: false, exactPhrase: false, includeArchiveTrash: false, ...extra };
      const times: number[] = [];
      let found = 0;
      for (let i = 0; i < RUNS; i++) {
        const t0 = performance.now();
        found = runSearchQuery(db, q, false, log).matches.length;
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(RUNS * 0.95)] ?? Infinity;
      expect(found).toBeGreaterThan(0);
      expect(p95, `p95 ${p95.toFixed(1)} ms`).toBeLessThanOrEqual(BUDGET_MS);
    });
  }
});

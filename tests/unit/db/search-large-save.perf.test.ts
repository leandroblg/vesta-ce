// T019: saving the largest details 005 allows stays within the 500 ms budget with the search triggers
// (006 C1, constitution VI, research §2). Details over 100,000 characters are marked pending by the trigger
// and indexed in full by the background fill (the user's decision).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { AlertSession } from "../../../src/main/alert-session";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { loadAlertSettings } from "../../../src/main/db/settings-repo";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { buildHandlers, dispatch, type HandlerDeps } from "../../../src/main/ipc/handlers";
import { UndoStore } from "../../../src/main/undo-store";
import { inProcessExtractor } from "../../../src/main/search/extract";
import { createFill } from "../../../src/main/search/fill";
import { budget } from "../perf-budget";
import { makeTask, tempDir } from "./helpers";

const MAX_DETAILS = 1_000_000;
const BUDGET_MS = budget(500);
const RUNS = 10;

const BLOCK = [
  "## Section heading",
  "",
  "Some **bold**, *italic* and ~~struck~~ text with `inline code`, a [link](https://example.com/page) and ==marked== [red]{color=\"#c00\"} words.",
  "",
  "| Name | Qty |",
  "| :--- | ---: |",
  "| apples | 3 |",
  "",
  "```js",
  "const total = items.reduce((a, b) => a + b, 0);",
  "```",
  "",
  "- [ ] first item",
  "- [x] second item",
  "",
  "<details><summary>More</summary>",
  "",
  "Hidden <b>body</b> &amp; text.",
  "",
  "</details>",
  "",
].join("\n");

function bigDetails(): string {
  const md = BLOCK.repeat(Math.ceil(MAX_DETAILS / BLOCK.length));
  return md.slice(0, MAX_DETAILS);
}

describe("large details saves with the search triggers (T019)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let deps: HandlerDeps;

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const clock = fakeClock(1_000_000_000_000);
    deps = {
      db: () => db,
      clock,
      log: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
      newId: () => "00000000-0000-4000-8000-0000000000aa",
      startup: () => ({ kind: "ok", folderNotWritable: false, abnormalExitAt: null, dataDir: dir }),
      onFlushDone: () => undefined,
      undo: new UndoStore(clock, () => "token"),
      alertSession: new AlertSession(clock),
      alertSettings: () => loadAlertSettings(db).settings,
      isPackaged: false,
      dataDir: dir,
      shell: { openPath: vi.fn(() => Promise.resolve("")), showItemInFolder: vi.fn(), openExternal: vi.fn(() => Promise.resolve()) },
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "darwin",
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it(`saves ${String(MAX_DETAILS)}-character details, and one-character edits of them, within ${String(BUDGET_MS)} ms each`, async () => {
    const task = makeTask({ titleMd: "Big" });
    applyChangeSet(db, { upserts: [task], removals: [] });
    const handlers = buildHandlers(deps);
    const base = bigDetails();
    expect(base.length).toBe(MAX_DETAILS);
    const times: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      // The first run writes the whole text; the others change one character, as a panel autosave would.
      const details = i === 0 ? base : `${base.slice(0, MAX_DETAILS - 1)}${String(i % 10)}`;
      const t0 = performance.now();
      const r = dispatch(handlers, deps, "tasks:edit-details", { id: task.id, details });
      times.push(performance.now() - t0);
      expect(r.ok).toBe(true);
    }
    const worst = Math.max(...times);
    console.log(`T019 large save: worst ${worst.toFixed(0)} ms, median ${[...times].sort((a, b) => a - b)[RUNS >> 1]?.toFixed(0) ?? "?"} ms`);
    expect(worst).toBeLessThanOrEqual(BUDGET_MS);
    const row = () => db.prepare("select body_plain, pending from search_docs where item_id = ?").get(task.id) as { body_plain: string; pending: number };
    // Saved without extracting the details: the row waits for the fill.
    expect(row()).toEqual({ body_plain: "", pending: 1 });
    // The fill indexes the full text, the last character included.
    const fill = createFill(() => db, inProcessExtractor, () => undefined, deps.log);
    fill.kick();
    await fill.idle();
    expect(row().pending).toBe(0);
    expect(row().body_plain.length).toBeGreaterThan(MAX_DETAILS / 2);
    expect(row().body_plain.endsWith(String((RUNS - 1) % 10))).toBe(true);
  }, 120_000);
});

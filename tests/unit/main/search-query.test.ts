// T024: the search:query handler over a seeded database (006 contracts/ipc.md, research §5).
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { AlertSession } from "../../../src/main/alert-session";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { applyReminderChangeSet } from "../../../src/main/db/reminders-repo";
import { loadAlertSettings } from "../../../src/main/db/settings-repo";
import { applyChangeSet } from "../../../src/main/db/tasks-repo";
import { buildHandlers, dispatch, type HandlerDeps } from "../../../src/main/ipc/handlers";
import type { Logger } from "../../../src/main/log";
import { UndoStore } from "../../../src/main/undo-store";
import type { SearchQuery, SearchResult } from "../../../src/shared/ipc-contract";
import { makeReminder, makeTask, tempDir } from "../db/helpers";

describe("search:query", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let deps: HandlerDeps;
  let log: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let pending = false;

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const clock = fakeClock(1_000_000_000_000);
    log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    pending = false;
    deps = {
      db: () => db,
      clock,
      log: log as unknown as Logger,
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
      searchIndex: { isPending: () => pending, kick: vi.fn() },
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  function q(text: string, extra: Partial<SearchQuery> = {}): SearchResult {
    const r = dispatch(buildHandlers(deps), deps, "search:query", {
      seq: 7,
      text,
      matchCase: false,
      exactPhrase: false,
      includeArchiveTrash: false,
      ...extra,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  }
  const ids = (r: SearchResult) => r.matches.map((m) => m.id).sort();

  it("echoes seq, and gives no matches for empty or whitespace-only text", () => {
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "anything" })], removals: [] });
    expect(q("")).toEqual({ seq: 7, matches: [], pending: false });
    expect(q("  \t ")).toEqual({ seq: 7, matches: [], pending: false });
  });

  it("finds tasks, subtasks and reminders by title, details and text, ignoring formatting", () => {
    const p = makeTask({ titleMd: "Renew **pass**port" });
    const s = makeTask({ titleMd: "Photos", parentId: p.id, detailsMd: "invoice **2291**" });
    const r = makeReminder({ textMd: "Call the bank before **Friday**" });
    applyChangeSet(db, { upserts: [p, s], removals: [] });
    applyReminderChangeSet(db, { upserts: [r], removals: [], sectionCollapsed: null }, 1);
    expect(ids(q("passport"))).toEqual([p.id]);
    expect(q("2291").matches).toEqual([{ kind: "task", id: s.id, inTitle: false, excerpt: "invoice 2291" }]);
    expect(q("before friday").matches).toEqual([{ kind: "reminder", id: r.id, inTitle: true, excerpt: null }]);
  });

  it("matches every special character literally, with no SQL or FTS5 error", () => {
    const words = ['"', "'", "%", "_", "\\", "*", "(", "-", ":", "NEAR", "AND", "OR", '"quoted"', "a%b_c", "x' OR 1=1 --", "NOT", "^"];
    const t = makeTask({ titleMd: `special ${words.join(" ")}` });
    const other = makeTask({ titleMd: "plain text here" });
    applyChangeSet(db, { upserts: [t, other], removals: [] });
    for (const w of words) expect(ids(q(w)), w).toEqual([t.id]);
    expect(ids(q("a%b_c", { exactPhrase: true }))).toEqual([t.id]);
    expect(ids(q("%"))).not.toContain(other.id);
  });

  it("handles 1-, 2- and 3+-character words (escaped LIKE below 3 characters)", () => {
    const a = makeTask({ titleMd: "Fix bike" });
    const b = makeTask({ titleMd: "Go to the dentist" });
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    expect(ids(q("x"))).toEqual([a.id]);
    expect(ids(q("go"))).toEqual([b.id]);
    expect(ids(q("go den"))).toEqual([b.id]);
    expect(ids(q("bik"))).toEqual([a.id]);
  });

  it("lets the matcher decide: a trigram candidate failing Match case or word boundaries is dropped", () => {
    const api = makeTask({ titleMd: "API keys" });
    const rapid = makeTask({ titleMd: "rapid fix" });
    const split = makeTask({ titleMd: "Renew pass", detailsMd: "port number" });
    applyChangeSet(db, { upserts: [api, rapid, split], removals: [] });
    expect(ids(q("API"))).toEqual([api.id, rapid.id].sort());
    expect(ids(q("API", { matchCase: true }))).toEqual([api.id]);
    expect(ids(q("passport"))).toEqual([]);
  });

  it("searches only active items unless includeArchiveTrash; a purged item is never returned", () => {
    const active = makeTask({ titleMd: "report active" });
    const done = makeTask({ titleMd: "report done", doneAt: 5 });
    const deleted = makeTask({ titleMd: "report deleted", deletedAt: 6 });
    const doneRem = makeReminder({ textMd: "report reminder", doneAt: 7 });
    applyChangeSet(db, { upserts: [active, done, deleted], removals: [] });
    applyReminderChangeSet(db, { upserts: [doneRem], removals: [], sectionCollapsed: null }, 1);
    expect(ids(q("report"))).toEqual([active.id]);
    expect(ids(q("report", { includeArchiveTrash: true }))).toEqual([active.id, done.id, deleted.id, doneRem.id].sort());
    applyChangeSet(db, { upserts: [], removals: [deleted.id] });
    expect(ids(q("report", { includeArchiveTrash: true }))).not.toContain(deleted.id);
  });

  it("sets inTitle and the excerpt as FR-013", () => {
    const t = makeTask({ titleMd: "Sales report", detailsMd: "the invoice 2291 is late" });
    applyChangeSet(db, { upserts: [t], removals: [] });
    expect(q("sales report").matches[0]).toMatchObject({ inTitle: true, excerpt: null });
    expect(q("sales invoice").matches[0]).toMatchObject({ inTitle: false, excerpt: "the invoice 2291 is late" });
  });

  it("answers pending: true at once while indexing is not complete", () => {
    applyChangeSet(db, { upserts: [makeTask({ titleMd: "report" })], removals: [] });
    pending = true;
    expect(q("report").pending).toBe(true);
    pending = false;
    expect(q("report").pending).toBe(false);
  });

  it("returns SAVE_FAILED on a database error and never logs the text", () => {
    db.exec("drop table search_fts");
    const r = dispatch(buildHandlers(deps), deps, "search:query", {
      seq: 1,
      text: "secret words here",
      matchCase: false,
      exactPhrase: false,
      includeArchiveTrash: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SAVE_FAILED");
    const logged = JSON.stringify([log.error.mock.calls, log.warn.mock.calls]);
    expect(logged).toContain("search.query-failed");
    expect(logged).not.toContain("secret");
  });
});

/** Main-process handlers on a temp database (003 T031 and later alert handlers). */
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock, type FakeClock } from "../../../src/domain/clock";
import { AlertSession } from "../../../src/main/alert-session";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { loadAlertSettings } from "../../../src/main/db/settings-repo";
import { applyChangeSet, loadAll } from "../../../src/main/db/tasks-repo";
import { initFaults } from "../../../src/main/faults";
import { buildAssetAsyncHandlers, buildHandlers, dispatch, registerHandlers, type HandlerDeps } from "../../../src/main/ipc/handlers";
import type { Logger } from "../../../src/main/log";
import { UndoStore } from "../../../src/main/undo-store";
import { makeReminder, makeTask, tempDir } from "../db/helpers";
import { applyReminderChangeSet, loadReminders } from "../../../src/main/db/reminders-repo";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { InvokeChannel } from "../../../src/shared/ipc-contract";

const shell = () => ({
  openPath: vi.fn(() => Promise.resolve("")),
  showItemInFolder: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
});
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGM4YWT0HxkzoAsAACR1EVnFpgq+AAAAAElFTkSuQmCC",
  "base64",
);

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T = 1_000_000_000_000;

describe("alerts:tick (003 FR-004 to FR-021, FR-044)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let clock: FakeClock;
  let deps: HandlerDeps;
  let log: Record<"fatal" | "error" | "warn" | "info" | "debug" | "trace", ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    clock = fakeClock(T);
    log = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() };
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
      shell: shell(),
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "darwin",
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  const tickNow = (visible: boolean) => {
    const r = dispatch(buildHandlers(deps), deps, "alerts:tick", { visible });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it("returns the changed rows, the episodes and main's time, and saves them", () => {
    const a = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T });
    applyChangeSet(db, { upserts: [a], removals: [] });
    tickNow(true); // the main view becomes visible at T
    clock.advance(DAY + MIN);
    const r = tickNow(true);
    expect(r.now).toBe(T + DAY + MIN);
    expect(r.episodes).toEqual([{ id: a.id, blinks: 3 }]);
    expect(r.upserts).toHaveLength(1);
    expect(r.upserts[0]).toMatchObject({ id: a.id, staleSince: T + DAY, lastBlinkAt: T + DAY + MIN, updatedAt: T });
    expect(r.removals).toEqual([]);
    expect(loadAll(db)[0]).toEqual(r.upserts[0]);
  });

  it("feeds the visibility record", () => {
    tickNow(true);
    expect(deps.alertSession.visibility()).toEqual({ visible: true, visibleSince: T });
    clock.advance(1000);
    tickNow(false);
    expect(deps.alertSession.visibility().visible).toBe(false);
  });

  it("on a failed save: rows for display, no episodes, a log line, no undo record; the next tick plays once", () => {
    const a = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T });
    applyChangeSet(db, { upserts: [a], removals: [] });
    tickNow(true);
    clock.advance(DAY + MIN);
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    const failed = tickNow(true);
    expect(failed.episodes).toEqual([]);
    expect(failed.upserts[0]).toMatchObject({ id: a.id, staleSince: T + DAY });
    expect(log.error).toHaveBeenCalledWith(
      "alerts.tick-save-failed",
      expect.objectContaining({ message: expect.any(String) as string }),
    );
    expect(loadAll(db)[0]?.staleSince).toBeNull();
    expect(() => deps.undo.take("token")).toThrow();
    delete process.env["VESTA_FAULT"];
    clock.advance(MIN);
    expect(tickNow(true).episodes).toEqual([{ id: a.id, blinks: 3 }]);
    clock.advance(MIN);
    expect(tickNow(true).episodes).toEqual([]);
  });
});

describe("004: testHooks, tasks:move and reminders:move (research §3, §8)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let deps: HandlerDeps;

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const clock = fakeClock(T);
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
      shell: shell(),
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "darwin",
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  const initial = () => {
    const r = dispatch(buildHandlers(deps), deps, "app:get-initial-state", undefined);
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it("is true in unpackaged builds", () => {
    expect(initial().testHooks).toBe(true);
  });

  it("is false in packaged builds, so window.__vestaTest is never defined there", () => {
    deps = { ...deps, isPackaged: true };
    expect(initial().testHooks).toBe(false);
  });

  it("app:get-initial-state carries the stored panel width (005 FR-005)", () => {
    expect(initial().panelWidth).toBe(420);
    db.prepare("update settings set value = '900' where key = 'panelWidth'").run();
    expect(initial().panelWidth).toBe(760);
  });

  it("settings:set-panel-width saves the width with the edit time", () => {
    const r = dispatch(buildHandlers(deps), deps, "settings:set-panel-width", { px: 512 });
    expect(r).toEqual({ ok: true, value: null });
    expect(db.prepare("select value, updated_at from settings where key = 'panelWidth'").get()).toEqual({
      value: "512",
      updated_at: T,
    });
    expect(initial().panelWidth).toBe(512);
    expect(dispatch(buildHandlers(deps), deps, "settings:set-panel-width", { px: 900 }).ok).toBe(false);
  });

  it("tasks:move saves the moved row through dispatch", () => {
    const a = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T, position: 1 });
    const b = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T, position: 2 });
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    const r = dispatch(buildHandlers(deps), deps, "tasks:move", { id: b.id, dest: { kind: "top", beforeId: a.id } });
    expect(r.ok).toBe(true);
    expect(
      loadAll(db)
        .sort((x, y) => x.position - y.position)
        .map((t) => t.id),
    ).toEqual([b.id, a.id]);
  });

  it("reminders:move saves the moved reminder", () => {
    const r1 = makeReminder({ position: 1 });
    const r2 = makeReminder({ position: 2 });
    applyReminderChangeSet(db, { upserts: [r1, r2], removals: [], sectionCollapsed: null }, T);
    const r = dispatch(buildHandlers(deps), deps, "reminders:move", { id: r2.id, beforeId: r1.id });
    expect(r.ok).toBe(true);
    expect(
      loadReminders(db)
        .sort((x, y) => x.position - y.position)
        .map((x) => x.id),
    ).toEqual([r2.id, r1.id]);
  });

  it("tasks:edit-details saves the details and returns the row (005 FR-009)", () => {
    const a = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T, detailsMd: "" });
    applyChangeSet(db, { upserts: [a], removals: [] });
    const r = dispatch(buildHandlers(deps), deps, "tasks:edit-details", { id: a.id, details: "- [ ] one" });
    expect(r.ok ? r.value.upserts.map((t) => t.detailsMd) : r.error.code).toEqual(["- [ ] one"]);
    expect(loadAll(db)[0]?.detailsMd).toBe("- [ ] one");
  });

  it("005 FR-010: with the save fault, tasks:edit-details returns SAVE_FAILED and nothing is saved", () => {
    const a = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T, detailsMd: "old" });
    applyChangeSet(db, { upserts: [a], removals: [] });
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    const r = dispatch(buildHandlers(deps), deps, "tasks:edit-details", { id: a.id, details: "new" });
    expect(r.ok ? null : r.error.code).toBe("SAVE_FAILED");
    expect(loadAll(db)[0]?.detailsMd).toBe("old");
  });

  it("FR-021: with the save fault, tasks:move returns SAVE_FAILED and the database is unchanged", () => {
    const a = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T, position: 1 });
    const b = makeTask({ createdAt: T, updatedAt: T, staleBaseAt: T, position: 2 });
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    initFaults(false);
    process.env["VESTA_FAULT"] = "save";
    const r = dispatch(buildHandlers(deps), deps, "tasks:move", { id: b.id, dest: { kind: "top", beforeId: a.id } });
    expect(r.ok ? null : r.error.code).toBe("SAVE_FAILED");
    expect(loadAll(db).find((t) => t.id === b.id)?.position).toBe(2);
  });
});

describe("005 asset and link handlers (contracts/ipc.md)", () => {
  let dir: string;
  let cleanup: () => void;
  let db: Database.Database;
  let deps: HandlerDeps;
  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const clock = fakeClock(1000);
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
      shell: shell(),
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "darwin",
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
  });
  const run = <C extends InvokeChannel>(channel: C, payload: unknown) =>
    dispatch(buildHandlers(deps), deps, channel, payload);
  const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? "ok" : r.error?.code);

  it("assets:import-bytes stores the file; TOO_LARGE and NOT_IMAGE are refusals", () => {
    const r = run("assets:import-bytes", { name: "a.png", bytes: new Uint8Array(PNG), scope: "title" });
    expect(r.ok && r.value).toMatchObject({ name: "a.png", isImage: true });
    expect(
      code(run("assets:import-bytes", { name: "a.pdf", bytes: new Uint8Array([37, 80, 68, 70]), scope: "title" })),
    ).toBe("NOT_IMAGE");
    expect(
      code(run("assets:import-bytes", { name: "big", bytes: new Uint8Array(104_857_601), scope: "details" })),
    ).toBe("INVALID");
  });

  it("assets:pick imports the chosen files and lists the refused names; cancel gives nothing", () => {
    const folder = join(dir, "picked");
    mkdirSync(folder);
    writeFileSync(join(folder, "photo.png"), PNG);
    writeFileSync(join(folder, "doc.pdf"), "%PDF");
    deps = {
      ...deps,
      dialog: {
        showOpenDialogSync: () => [join(folder, "photo.png"), join(folder, "doc.pdf"), join(folder, "gone.png")],
        confirmImport: () => Promise.resolve(true),
      },
    };
    const r = run("assets:pick", { scope: "title" });
    expect(r.ok && r.value.refs.map((x) => x.name)).toEqual(["photo.png"]);
    expect(r.ok && r.value.refused).toEqual(["doc.pdf", "gone.png"]);
    deps = { ...deps, dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) } };
    expect(run("assets:pick", { scope: "details" })).toEqual({ ok: true, value: { refs: [], refused: [] } });
  });

  it("M1 assets:import-path asks first, then copies a file; a missing one is NOT_FOUND without a dialog (010 FR-001)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "vesta-outside-"));
    const file = join(outside, "x.txt");
    writeFileSync(file, "hello");
    const asked: { name: string; folder: string }[] = [];
    let answer = false;
    deps = { ...deps, dialog: { showOpenDialogSync: () => undefined, confirmImport: (req) => { asked.push(req); return Promise.resolve(answer); } } };
    const handler = buildAssetAsyncHandlers(deps)["assets:import-path"];
    if (handler === undefined) throw new Error("no handler");
    await expect(handler({ path: file, scope: "details" })).rejects.toMatchObject({ code: "CANCELLED" });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.name).toBe("x.txt");
    answer = true;
    expect((await handler({ path: file, scope: "details" })).name).toBe("x.txt");
    await expect(handler({ path: join(outside, "nope.txt"), scope: "details" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(asked).toHaveLength(2);
    await expect(handler({ path: join(dir, "data.sqlite"), scope: "details" })).rejects.toMatchObject({ code: "INSIDE_DATA" });
    expect(asked).toHaveLength(2);
    rmSync(outside, { recursive: true, force: true });
  });

  it("assets:open opens with the default app, shows executables in the folder, and NOT_FOUND otherwise (FR-031)", () => {
    const pdf = run("assets:import-bytes", {
      name: "a.pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
      scope: "details",
    });
    const sh = run("assets:import-bytes", { name: "run.sh", bytes: new Uint8Array([35, 33]), scope: "details" });
    const bin = run("assets:import-bytes", { name: "tool", bytes: new Uint8Array([1, 2, 3]), scope: "details" });
    if (!pdf.ok || !sh.ok || !bin.ok) throw new Error("import failed");
    expect(run("assets:open", { ref: pdf.value.ref })).toEqual({ ok: true, value: null });
    expect(deps.shell.openPath).toHaveBeenCalledWith(join(dir, pdf.value.ref));
    run("assets:open", { ref: sh.value.ref });
    expect(deps.shell.showItemInFolder).toHaveBeenCalledWith(join(dir, sh.value.ref));
    chmodSync(join(dir, bin.value.ref), 0o755);
    run("assets:open", { ref: bin.value.ref });
    expect(deps.shell.showItemInFolder).toHaveBeenCalledWith(join(dir, bin.value.ref));
    expect(code(run("assets:open", { ref: `assets/${"e".repeat(64)}.pdf` }))).toBe("NOT_FOUND");
  });

  it("008 FR-034: assets:open finds the stored file by hash whatever the extension; the stored name decides executability", () => {
    const pdf = run("assets:import-bytes", { name: "a.pdf", bytes: new Uint8Array([37, 80, 68, 70, 9]), scope: "details" });
    const sh = run("assets:import-bytes", { name: "run.sh", bytes: new Uint8Array([35, 33, 9]), scope: "details" });
    if (!pdf.ok || !sh.ok) throw new Error("import failed");
    const hashOf = (ref: string) => ref.slice("assets/".length, "assets/".length + 64);
    expect(run("assets:open", { ref: `assets/${hashOf(pdf.value.ref)}.doc` })).toEqual({ ok: true, value: null });
    expect(deps.shell.openPath).toHaveBeenLastCalledWith(join(dir, pdf.value.ref));
    run("assets:open", { ref: `assets/${hashOf(sh.value.ref)}.pdf` });
    expect(deps.shell.showItemInFolder).toHaveBeenLastCalledWith(join(dir, sh.value.ref));
  });

  it("app:open-external opens web and mail links only", () => {
    expect(run("app:open-external", { url: "https://example.com" })).toEqual({ ok: true, value: null });
    expect(deps.shell.openExternal).toHaveBeenCalledWith("https://example.com");
    expect(code(run("app:open-external", { url: "file:///etc/passwd" }))).toBe("INVALID");
  });
});

describe("009 Trace: one ipc.call entry per call, never the payload (FR-003, research §4)", () => {
  let cleanup: () => void;
  let db: Database.Database;

  afterEach(() => {
    db.close();
    cleanup();
  });

  it("logs the channel, time, outcome and size of each call, and none of its text", async () => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    const clock = fakeClock(T);
    const log = { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() };
    const deps: HandlerDeps = {
      db: () => db,
      clock,
      log,
      newId: () => "00000000-0000-4000-8000-0000000000aa",
      startup: () => ({ kind: "ok", folderNotWritable: false, abnormalExitAt: null, dataDir: dir }),
      onFlushDone: () => undefined,
      undo: new UndoStore(clock, () => "token"),
      alertSession: new AlertSession(clock),
      alertSettings: () => loadAlertSettings(db).settings,
      isPackaged: false,
      dataDir: dir,
      shell: shell(),
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "darwin",
    };
    const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>();
    const ipc = { handle: (channel: string, fn: (event: unknown, payload: unknown) => unknown) => handlers.set(channel, fn) };
    registerHandlers(ipc as unknown as Parameters<typeof registerHandlers>[0], buildHandlers(deps), deps, () => true);
    const event = { senderFrame: { url: "file:///app/index.html" } };
    await handlers.get("tasks:create")?.(event, { title: "Pay the SECRET invoice", parentId: null });
    await handlers.get("tasks:create")?.(event, { title: 3, parentId: null });

    const calls = log.trace.mock.calls.filter(([e]) => e === "ipc.call");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toEqual({ channel: "tasks:create", ms: expect.any(Number) as number, ok: true, bytes: "Pay the SECRET invoice".length + 8 });
    expect(calls[1]?.[1]).toMatchObject({ channel: "tasks:create", ok: false });
    expect(JSON.stringify(log.trace.mock.calls)).not.toContain("SECRET");
  });
});

describe("015 history events written with their change (FR-017, FR-019, research §4; T030)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let clock: FakeClock;
  let deps: HandlerDeps;
  let n = 0;

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    clock = fakeClock(T);
    deps = {
      db: () => db,
      clock,
      log: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
      newId: () => `00000000-0000-4000-8000-${(n++).toString(16).padStart(12, "0")}`,
      startup: () => ({ kind: "ok", folderNotWritable: false, abnormalExitAt: null, dataDir: dir }),
      onFlushDone: () => undefined,
      undo: new UndoStore(clock, () => `token-${String(n++)}`),
      alertSession: new AlertSession(clock),
      alertSettings: () => loadAlertSettings(db).settings,
      isPackaged: false,
      dataDir: dir,
      shell: shell(),
      dialog: { showOpenDialogSync: () => undefined, confirmImport: () => Promise.resolve(true) },
      platform: "darwin",
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
    delete process.env["VESTA_FAULT"];
    initFaults(true);
  });

  const call = (channel: InvokeChannel, payload: unknown) => {
    const r = dispatch(buildHandlers(deps), deps, channel, payload as never);
    if (!r.ok) throw new Error(r.error.message);
    return r.value as never as Record<string, unknown> & { events?: { upserts: { kind: string; at: number; taskId: string; detail: number | null; seq: number }[]; removals: string[] } };
  };
  const stored = () => db.prepare("select task_id as taskId, kind, at, detail from task_events order by at, rowid").all() as { taskId: string; kind: string; at: number; detail: number | null }[];

  it("tasks:create writes the created event and returns it with its recording order", () => {
    const r = call("tasks:create", { title: "A", parentId: null });
    const id = (r["upserts"] as { id: string }[])[0]?.id ?? "";
    expect(stored()).toEqual([{ taskId: id, kind: "created", at: T, detail: null }]);
    expect(r.events?.upserts.map((e) => [e.kind, typeof e.seq])).toEqual([["created", "number"]]);
  });

  it("mark done on a parent writes done for it and its subtask; Undo removes both and returns their ids (Q215)", () => {
    const p = makeTask({ createdAt: T });
    const s = makeTask({ createdAt: T, parentId: p.id });
    applyChangeSet(db, { upserts: [p, s], removals: [] });
    const done = call("tasks:mark-done", { id: p.id });
    expect(stored().map((e) => [e.taskId, e.kind]).sort()).toEqual([[p.id, "done"], [s.id, "done"]].sort());
    const undone = call("undo:apply", { token: done["undoToken"] });
    expect(stored()).toEqual([]);
    expect(undone.events?.removals).toHaveLength(2);
  });

  it("with the save fault, neither the row nor its event is saved", () => {
    const a = makeTask({ createdAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY, staleSince: T - DAY, wasStale: true });
    applyChangeSet(db, { upserts: [a], removals: [] });
    process.env["VESTA_FAULT"] = "save";
    initFaults(false);
    const r = dispatch(buildHandlers(deps), deps, "tasks:reschedule", { id: a.id, forMin: 120 });
    expect(r.ok).toBe(false);
    expect(stored()).toEqual([]);
    expect(loadAll(db)[0]?.staleSince).toBe(T - DAY);
  });

  it("the tick writes stale at the real moment; a longer global period writes unstale (Q216)", () => {
    const a = makeTask({ createdAt: T - 2 * DAY, updatedAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY });
    applyChangeSet(db, { upserts: [a], removals: [] });
    const tick = call("alerts:tick", { visible: true });
    expect(stored()).toEqual([{ taskId: a.id, kind: "stale", at: T - DAY, detail: null }]);
    expect(tick.events?.upserts.map((e) => e.kind)).toEqual(["stale"]);
    clock.advance(MIN);
    call("settings:set-alert", { key: "alertPeriodMin", minutes: 10 * 1440 });
    expect(stored().map((e) => e.kind)).toEqual(["stale", "unstale"]);
  });

  it("override changes within a minute merge into one event (Q214)", () => {
    const a = makeTask({ createdAt: T - MIN, staleBaseAt: T - MIN });
    applyChangeSet(db, { upserts: [a], removals: [] });
    call("tasks:set-alert-override", { id: a.id, minutes: 2 * 1440 });
    clock.advance(20_000);
    const merged = call("tasks:set-alert-override", { id: a.id, minutes: 3 * 1440 });
    expect(stored()).toEqual([{ taskId: a.id, kind: "override_set", at: T + 20_000, detail: 3 * 1440 }]);
    expect(merged.events?.upserts.map((e) => [e.kind, e.detail])).toEqual([["override_set", 3 * 1440]]);
    clock.advance(2 * MIN);
    call("tasks:set-alert-override", { id: a.id, minutes: null });
    expect(stored().map((e) => e.kind)).toEqual(["override_set", "override_cleared"]);
  });

  it("tasks:history returns one task's events in recording order; delete permanently removes them", () => {
    const a = makeTask({ createdAt: T, deletedAt: T + 1 });
    const b = makeTask({ createdAt: T });
    applyChangeSet(db, { upserts: [a, b], removals: [] });
    call("tasks:restore", { id: a.id });
    call("tasks:mark-done", { id: b.id });
    const r = dispatch(buildHandlers(deps), deps, "tasks:history", { id: a.id });
    expect(r.ok && r.value.map((e) => e.kind)).toEqual(["restored"]);
    expect(r.ok && r.value.every((e) => typeof e.seq === "number")).toBe(true);
    call("tasks:delete", { id: a.id });
    call("tasks:delete-permanently", { id: a.id });
    expect(stored().filter((e) => e.taskId === a.id)).toEqual([]);
  });

  it("016 FR-001, FR-002 a reschedule is undoable: Undo restores the row and deletes its event in one transaction", () => {
    const a = makeTask({ createdAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY, staleSince: T - DAY, wasStale: true, position: 3, manuallyPositioned: true });
    applyChangeSet(db, { upserts: [a], removals: [] });
    const r = call("tasks:reschedule", { id: a.id, forMin: 120 });
    expect(typeof r["undoToken"]).toBe("string");
    expect(stored().map((e) => [e.kind, e.detail])).toEqual([["rescheduled", 120]]);
    clock.advance(1000);
    const undone = call("undo:apply", { token: r["undoToken"] });
    expect(stored()).toEqual([]);
    expect(undone.events?.removals).toHaveLength(1);
    expect(typeof undone["redoToken"]).toBe("string");
    expect(loadAll(db)[0]).toMatchObject({ staleSince: T - DAY, staleBaseAt: T - 2 * DAY, rescheduleForMin: null, position: 3, manuallyPositioned: true });
  });

  it("016 FR-004 Redo reschedules again for the undone duration from now and offers Undo again", () => {
    const a = makeTask({ createdAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY, staleSince: T - DAY, wasStale: true });
    applyChangeSet(db, { upserts: [a], removals: [] });
    const r = call("tasks:reschedule", { id: a.id, forMin: null });
    // FR-011 (Q229): a plain reschedule records the tolerance in force.
    expect(stored().map((e) => e.detail)).toEqual([1440]);
    const undone = call("undo:apply", { token: r["undoToken"] });
    clock.advance(5000);
    const redone = call("undo:redo", { token: undone["redoToken"] });
    expect(typeof redone["undoToken"]).toBe("string");
    expect(loadAll(db)[0]).toMatchObject({ staleSince: null, staleBaseAt: T + 5000, rescheduleForMin: 1440 });
    expect(stored().map((e) => [e.kind, e.at, e.detail])).toEqual([["rescheduled", T + 5000, 1440]]);
  });

  it("016 FR-006 (Q256) any other list action between Undo and Redo makes Redo expire", () => {
    const a = makeTask({ createdAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY, staleSince: T - DAY, wasStale: true });
    applyChangeSet(db, { upserts: [a], removals: [] });
    const r = call("tasks:reschedule", { id: a.id, forMin: 120 });
    const undone = call("undo:apply", { token: r["undoToken"] });
    call("tasks:edit-title", { id: a.id, title: "Renamed" });
    const redo = dispatch(buildHandlers(deps), deps, "undo:redo", { token: undone["redoToken"] as string });
    expect(!redo.ok && redo.error.code).toBe("UNDO_EXPIRED");
  });

  it("016 FR-004a with the save fault, neither Undo nor Redo leaves a partial write", () => {
    const a = makeTask({ createdAt: T - 2 * DAY, staleBaseAt: T - 2 * DAY, staleSince: T - DAY, wasStale: true });
    applyChangeSet(db, { upserts: [a], removals: [] });
    const r = call("tasks:reschedule", { id: a.id, forMin: 120 });
    process.env["VESTA_FAULT"] = "save";
    initFaults(false);
    const failed = dispatch(buildHandlers(deps), deps, "undo:apply", { token: r["undoToken"] as string });
    expect(!failed.ok && failed.error.code).toBe("SAVE_FAILED");
    expect(stored().map((e) => e.kind)).toEqual(["rescheduled"]);
    expect(loadAll(db)[0]?.staleSince).toBeNull();
  });

  it("016 clipboard:write writes text and html through the injected clipboard (FR-016)", () => {
    const writes: { text: string; html?: string }[] = [];
    deps = { ...deps, clipboard: { write: (d) => { writes.push(d); } } };
    call("clipboard:write", { text: "Docs", html: "<a href=\"https://e.com\">Docs</a>" });
    call("clipboard:write", { text: "https://e.com", html: null });
    expect(writes).toEqual([{ text: "Docs", html: "<a href=\"https://e.com\">Docs</a>" }, { text: "https://e.com" }]);
  });
  it("018 FR-010 tasks:delete on an Archive row sends it to the Trash with its group; Undo returns them to the Archive", () => {
    const p = makeTask({ createdAt: T, doneAt: T + 10 });
    const s1 = makeTask({ createdAt: T, parentId: p.id, doneAt: T + 10, leftWithId: p.id });
    applyChangeSet(db, { upserts: [p, s1], removals: [] });
    const r = call("tasks:delete", { id: p.id });
    expect(typeof r["undoToken"]).toBe("string");
    const rows = loadAll(db);
    for (const t of rows) expect(t).toMatchObject({ doneAt: null, deletedAt: T, keptDoneAt: T + 10 });
    expect(stored().map((e) => e.kind)).toEqual(["trashed", "trashed"]);
    clock.advance(1000);
    call("undo:apply", { token: r["undoToken"] });
    for (const t of loadAll(db)) expect(t).toMatchObject({ doneAt: T + 10, deletedAt: null, keptDoneAt: null });
    expect(loadAll(db).find((t) => t.id === s1.id)?.leftWithId).toBe(p.id);
    expect(stored()).toEqual([]);
  });

  it("018 tasks:delete on an active row is unchanged, and on a Trash row INVALID", () => {
    const a = makeTask({ createdAt: T });
    const gone = makeTask({ createdAt: T, deletedAt: T + 5 });
    applyChangeSet(db, { upserts: [a, gone], removals: [] });
    call("tasks:delete", { id: a.id });
    expect(loadAll(db).find((t) => t.id === a.id)).toMatchObject({ deletedAt: T, keptDoneAt: null });
    const r = dispatch(buildHandlers(deps), deps, "tasks:delete", { id: gone.id });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("INVALID");
  });

  it("018 FR-010 reminders:delete on an Archive reminder sends it to the Trash; Undo returns it; a Trash one is INVALID", () => {
    const r1 = makeReminder({ doneAt: T + 10 });
    const r2 = makeReminder({ deletedAt: T + 5 });
    applyReminderChangeSet(db, { upserts: [r1, r2], removals: [], sectionCollapsed: null }, T);
    const r = call("reminders:delete", { id: r1.id });
    expect(loadReminders(db).find((x) => x.id === r1.id)).toMatchObject({ doneAt: null, deletedAt: T, keptDoneAt: T + 10 });
    call("undo:apply", { token: r["undoToken"] });
    expect(loadReminders(db).find((x) => x.id === r1.id)).toMatchObject({ doneAt: T + 10, deletedAt: null, keptDoneAt: null });
    const bad = dispatch(buildHandlers(deps), deps, "reminders:delete", { id: r2.id });
    expect(!bad.ok && bad.error.code).toBe("INVALID");
  });
});


describe("017: no file is stored while newer data is refused (FR-015a, contracts/newer-data.md)", () => {
  let cleanup: () => void;
  let dir: string;
  let db: Database.Database;
  let deps: HandlerDeps;
  let dialogOpened: number;

  beforeEach(() => {
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    db.pragma("query_only = ON");
    dialogOpened = 0;
    const clock = fakeClock(T);
    deps = {
      db: () => db,
      clock,
      log: { fatal: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
      newId: () => "00000000-0000-4000-8000-0000000000bb",
      startup: () => ({ kind: "newerData", dataVersion: 99, latestVersion: 12, folderNotWritable: false, abnormalExitAt: null, dataDir: dir }),
      onFlushDone: () => undefined,
      undo: new UndoStore(clock, () => "token"),
      alertSession: new AlertSession(clock),
      alertSettings: () => loadAlertSettings(db).settings,
      isPackaged: false,
      dataDir: dir,
      shell: shell(),
      dialog: {
        showOpenDialogSync: () => {
          dialogOpened++;
          return undefined;
        },
        confirmImport: () => Promise.resolve(true),
      },
      platform: "darwin",
    };
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it("refuses pasted or dropped bytes as a failed save, writing nothing to assets/", () => {
    const r = dispatch(buildHandlers(deps), deps, "assets:import-bytes", { name: "a.png", bytes: PNG, scope: "details" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SAVE_FAILED");
    expect(existsSync(join(dir, "assets"))).toBe(false);
  });

  it("refuses Insert file before its dialog opens", () => {
    const r = dispatch(buildHandlers(deps), deps, "assets:pick", { scope: "details" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SAVE_FAILED");
    expect(dialogOpened).toBe(0);
  });
});

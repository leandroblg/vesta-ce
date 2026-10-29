import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { openDatabase } from "../../../src/main/db/connection";
import { migrate } from "../../../src/main/db/migrate";
import { loadLogSettings } from "../../../src/main/db/settings-repo";
import { dispatch, dispatchAsync, type HandlerDeps } from "../../../src/main/ipc/handlers";
import { buildUpdateHandlers } from "../../../src/main/ipc/update-handlers";
import type { UpdateScheduler } from "../../../src/main/updates/scheduler";
import type { UpdateState } from "../../../src/shared/ipc-contract";
import { tempDir } from "../db/helpers";

const REPO = { owner: "OWNER", repo: "vesta" };
const STATE: UpdateState = { checking: false, auto: true, result: { kind: "none" }, mark: false, announce: null };

describe("009 update handlers (contracts/ipc.md; FR-021a, FR-024a, FR-024b)", () => {
  let cleanup: () => void;
  let db: Database.Database;
  let links: { file: string | null; release: string | null };
  const scheduler = {
    setAuto: vi.fn((on: boolean) => ({ ...STATE, auto: on })),
    updatesShown: vi.fn(() => STATE),
    checkNow: vi.fn(() => Promise.resolve({ ...STATE, result: { kind: "upToDate" as const, checkedAt: 1 } })),
    links: () => links,
  };
  const shell = { openExternal: vi.fn(() => Promise.resolve()) };
  const log = { warn: vi.fn() };
  const deps = { log } as unknown as HandlerDeps;
  const build = () => buildUpdateHandlers({ db: () => db, clock: fakeClock(5), scheduler: () => scheduler as unknown as UpdateScheduler, shell, repo: REPO, log });

  beforeEach(() => {
    let dir: string;
    ({ dir, cleanup } = tempDir());
    db = openDatabase(join(dir, "data.sqlite"));
    migrate(db);
    links = { file: null, release: null };
    vi.clearAllMocks();
  });
  afterEach(() => {
    db.close();
    cleanup();
  });

  it("stores the automatic-check setting and hands it to the scheduler", () => {
    const r = dispatch(build().handlers, deps, "settings:set-auto-update-check", { on: false });
    expect(r).toEqual({ ok: true, value: { ...STATE, auto: false } });
    expect(scheduler.setAuto).toHaveBeenCalledWith(false);
    expect(loadLogSettings(db).autoUpdateCheck).toBe(false);
  });

  it("checks now, and tells the scheduler the Updates pane was shown (013 FR-024)", async () => {
    const { handlers, asyncHandlers } = build();
    expect(await dispatchAsync(asyncHandlers, deps, "updates:check", undefined)).toMatchObject({ ok: true, value: { result: { kind: "upToDate" } } });
    expect(dispatch(handlers, deps, "updates:pane-shown", { shown: true }).ok).toBe(true);
    expect(scheduler.updatesShown).toHaveBeenCalledWith(true);
    expect(dispatch(handlers, deps, "updates:pane-shown", { shown: false }).ok).toBe(true);
    expect(scheduler.updatesShown).toHaveBeenLastCalledWith(false);
  });

  it("opens only the checked release addresses, in the default browser", () => {
    const { handlers } = build();
    expect(dispatch(handlers, deps, "updates:open", { target: "file" })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    links = { file: "https://github.com/OWNER/vesta/releases/download/v0.2.0/Vesta-0.2.0-mac-arm64.zip", release: "https://github.com/OWNER/vesta/releases/tag/v0.2.0" };
    expect(dispatch(handlers, deps, "updates:open", { target: "file" }).ok).toBe(true);
    expect(dispatch(handlers, deps, "updates:open", { target: "release" }).ok).toBe(true);
    expect(shell.openExternal.mock.calls).toEqual([[links.file], [links.release]]);
    links = { file: "https://evil.example/x.zip", release: null };
    expect(dispatch(handlers, deps, "updates:open", { target: "file" })).toMatchObject({ ok: false, error: { code: "INVALID" } });
    expect(log.warn).toHaveBeenCalledWith("update.link-refused", { scheme: "https", host: "evil.example" });
    expect(shell.openExternal).toHaveBeenCalledTimes(2);
  });
});

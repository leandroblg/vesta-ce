import { describe, expect, it } from "vitest";
import { DomainError } from "../../../src/domain/task";
import { SaveFailedError } from "../../../src/main/db/tasks-repo";
import { UndoExpiredError, toResult } from "../../../src/main/ipc/result";

function fakeLog() {
  const entries: { level: string; event: string; fields: Record<string, unknown> }[] = [];
  const make = (level: string) => (event: string, fields: Record<string, unknown> = {}) => {
    entries.push({ level, event, fields });
  };
  return {
    log: { fatal: make("fatal"), error: make("error"), warn: make("warn"), info: make("info"), debug: make("debug"), trace: make("trace") },
    entries,
  };
}

describe("toResult (FR-040)", () => {
  it("wraps a value", () => {
    const { log } = fakeLog();
    expect(toResult("tasks:create", [], () => 42, log)).toEqual({ ok: true, value: 42 });
  });

  it("maps SaveFailedError to SAVE_FAILED and logs action, ids and message once", () => {
    const { log, entries } = fakeLog();
    const r = toResult(
      "tasks:mark-done",
      ["a", "b"],
      () => {
        throw new SaveFailedError(new Error("SQLITE_FULL: database or disk is full"));
      },
      log,
    );
    expect(r).toEqual({ ok: false, error: { code: "SAVE_FAILED", message: "SQLITE_FULL: database or disk is full" } });
    expect(entries).toEqual([
      {
        level: "error",
        event: "save.failed",
        fields: { action: "tasks:mark-done", ids: ["a", "b"], message: "SQLITE_FULL: database or disk is full" },
      },
    ]);
  });

  it("maps domain rule errors to INVALID or NOT_FOUND without an error log", () => {
    const { log, entries } = fakeLog();
    expect(toResult("tasks:delete", ["x"], () => { throw new DomainError("INVALID", "not active"); }, log)).toMatchObject({
      ok: false,
      error: { code: "INVALID" },
    });
    expect(toResult("tasks:delete", ["x"], () => { throw new DomainError("NOT_FOUND", "no row"); }, log)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(entries.filter((e) => e.level === "error")).toEqual([]);
  });

  it("maps UndoExpiredError to UNDO_EXPIRED", () => {
    const { log } = fakeLog();
    expect(toResult("undo:apply", [], () => { throw new UndoExpiredError(); }, log)).toMatchObject({
      ok: false,
      error: { code: "UNDO_EXPIRED" },
    });
  });

  it("treats any other error as a failed save and logs it", () => {
    const { log, entries } = fakeLog();
    expect(toResult("tasks:create", ["n"], () => { throw new TypeError("boom"); }, log)).toMatchObject({
      ok: false,
      error: { code: "SAVE_FAILED", message: "boom" },
    });
    expect(entries[0]).toMatchObject({ level: "error", event: "save.failed", fields: { action: "tasks:create", ids: ["n"] } });
  });
});

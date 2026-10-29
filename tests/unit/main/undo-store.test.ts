import { describe, expect, it } from "vitest";
import { fakeClock } from "../../../src/domain/clock";
import { UndoExpiredError } from "../../../src/main/ipc/result";
import { UndoStore } from "../../../src/main/undo-store";
import { mk, mkReminder } from "../domain/fixtures";

describe("UndoStore (FR-028)", () => {
  function store() {
    const clock = fakeClock(1000);
    let n = 0;
    return { clock, undo: new UndoStore(clock, () => `tok-${String(++n)}`) };
  }

  it("keeps only the latest record", () => {
    const { undo } = store();
    const first = undo.put("done", [mk()]);
    const second = undo.put("delete", [mk()]);
    expect(() => undo.take(first)).toThrow(UndoExpiredError);
    expect(undo.take(second).kind).toBe("delete");
  });

  it("expires after 11 s (10 s plus IPC slack)", () => {
    const { undo, clock } = store();
    const token = undo.put("done", [mk()]);
    clock.advance(11_000);
    expect(() => undo.take(token)).toThrow(UndoExpiredError);
    const fresh = undo.put("done", [mk()]);
    clock.advance(10_999);
    expect(undo.take(fresh).kind).toBe("done");
  });

  it("applying consumes the record", () => {
    const { undo } = store();
    const token = undo.put("restore", [mk()]);
    undo.take(token);
    expect(() => undo.take(token)).toThrow(UndoExpiredError);
  });

  it("a reminder record replaces a task record and the reverse: one latest action (002 FR-014)", () => {
    const { undo } = store();
    const task = undo.put("done", [mk()]);
    const reminder = undo.putReminder("delete", [mkReminder()]);
    expect(() => undo.take(task)).toThrow(UndoExpiredError);
    const taken = undo.take(reminder);
    expect(taken).toMatchObject({ subject: "reminder", kind: "delete" });
    const again = undo.putReminder("done", [mkReminder()]);
    const taskAgain = undo.put("restore", [mk()]);
    expect(() => undo.take(again)).toThrow(UndoExpiredError);
    expect(undo.take(taskAgain).kind).toBe("restore");
  });

  it("a reminder record expires after 11 s too", () => {
    const { undo, clock } = store();
    const token = undo.putReminder("done", [mkReminder()]);
    clock.advance(11_000);
    expect(() => undo.take(token)).toThrow(UndoExpiredError);
  });
});

describe("016 redo record (FR-004, FR-006, Q256)", () => {
  function store() {
    const clock = fakeClock(1000);
    let n = 0;
    return { clock, undo: new UndoStore(clock, () => `tok-${String(++n)}`) };
  }
  it("takes a redo record within 11 s, once", () => {
    const { undo, clock } = store();
    const token = undo.putRedo("task-1", 120);
    clock.advance(10_999);
    expect(undo.takeRedo(token)).toMatchObject({ taskId: "task-1", forMin: 120 });
    expect(() => undo.takeRedo(token)).toThrow(UndoExpiredError);
  });
  it("expires after 11 s", () => {
    const { undo, clock } = store();
    const token = undo.putRedo("task-1", 60);
    clock.advance(11_000);
    expect(() => undo.takeRedo(token)).toThrow(UndoExpiredError);
  });
  it("is replaced by any put or putReminder, and cleared by clearRedo", () => {
    for (const replace of [
      (u: UndoStore) => u.put("done", [mk()]),
      (u: UndoStore) => u.putReminder("done", [mkReminder()]),
      (u: UndoStore) => {
        u.clearRedo();
      },
    ]) {
      const { undo } = store();
      const token = undo.putRedo("task-1", 60);
      replace(undo);
      expect(() => undo.takeRedo(token)).toThrow(UndoExpiredError);
    }
  });
  it("a redo record is not an undo record, and the reverse", () => {
    const { undo } = store();
    const u = undo.put("reschedule", [mk()]);
    expect(() => undo.takeRedo(u)).toThrow(UndoExpiredError);
    const r = undo.putRedo("task-1", 60);
    expect(() => undo.take(r)).toThrow(UndoExpiredError);
  });
});

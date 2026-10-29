/** 015 deriveEvents (research §2, data-model.md "Derivation"; FR-016 to FR-019, PRD Q206, Q214–Q216; T028). */
import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { markDone, remove, reschedule, restore, setAlertOverride, trashDone } from "../../../src/domain/actions";
import { fixedClock } from "../../../src/domain/clock";
import type { ChangeSet, Task } from "../../../src/domain/task";
import { deriveEvents, type DeriveContext, type TaskEvent } from "../../../src/domain/task-events";
import { idGen, mk } from "./fixtures";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T = 1_000_000_000_000;
const NOW = T + 3 * DAY;

function ctx(over: Partial<DeriveContext> = {}): DeriveContext {
  return { now: NOW, newId: idGen(5000), origin: "action", lastEvents: new Map(), toleranceMin: 1440, ...over };
}
const cs = (upserts: Task[]): ChangeSet => ({ upserts, removals: [] });
const kinds = (w: { inserts: TaskEvent[] }) => w.inserts.map((e) => [e.taskId, e.kind, e.at, e.detail]);

describe("015 deriveEvents: one event per change of a row (research §2)", () => {
  it("a new row is created at its createdAt", () => {
    const t = mk({ createdAt: NOW - 5 });
    expect(kinds(deriveEvents([], cs([t]), ctx()))).toEqual([[t.id, "created", NOW - 5, null]]);
  });

  it("staleSince null → set is stale at the real stale moment (FR-018)", () => {
    const b = mk({ createdAt: T });
    const u = { ...b, staleSince: T + DAY, wasStale: true };
    expect(kinds(deriveEvents([b], cs([u]), ctx({ origin: "tick" })))).toEqual([[b.id, "stale", T + DAY, null]]);
  });

  it("016 FR-011 (Q229) a reschedule records the quick duration, or the tolerance in force", () => {
    const b = mk({ createdAt: T, staleSince: T + DAY, wasStale: true });
    const quick = reschedule(b.id, [b], fixedClock(NOW), DEFAULT_ALERT_SETTINGS, 120);
    expect(kinds(deriveEvents([b], quick, ctx()))).toEqual([[b.id, "rescheduled", NOW, 120]]);
    const tol = reschedule(b.id, [b], fixedClock(NOW));
    expect(kinds(deriveEvents([b], tol, ctx()))).toEqual([[b.id, "rescheduled", NOW, 1440]]);
    expect(kinds(deriveEvents([b], tol, ctx({ toleranceMin: 1800 })))).toEqual([[b.id, "rescheduled", NOW, 1800]]);
    expect(deriveEvents([b], tol, ctx({ origin: "undo" })).inserts).toEqual([]);
    expect(deriveEvents([b], tol, ctx({ origin: "import" })).inserts).toEqual([]);
  });

  it("staleSince set → null with staleBaseAt unchanged is unstale (Q216); with a reschedule it is not", () => {
    const b = mk({ createdAt: T, staleSince: T + DAY, wasStale: true });
    expect(kinds(deriveEvents([b], cs([{ ...b, staleSince: null }]), ctx({ origin: "period" })))).toEqual([[b.id, "unstale", NOW, null]]);
    expect(kinds(deriveEvents([b], reschedule(b.id, [b], fixedClock(NOW)), ctx())).map((k) => k[1])).toEqual(["rescheduled"]);
  });

  it("the override: set, changed, cleared, with the new minutes", () => {
    const none = mk({ createdAt: NOW - HOUR });
    const set = setAlertOverride(none.id, 3 * 1440, [none], fixedClock(NOW));
    expect(kinds(deriveEvents([none], set, ctx()))).toEqual([[none.id, "override_set", NOW, 3 * 1440]]);
    const has = { ...none, alertOverrideMin: 3 * 1440 };
    expect(kinds(deriveEvents([has], cs([{ ...has, alertOverrideMin: 2 * 1440 }]), ctx()))).toEqual([[none.id, "override_changed", NOW, 2 * 1440]]);
    expect(kinds(deriveEvents([has], cs([{ ...has, alertOverrideMin: null }]), ctx()))).toEqual([[none.id, "override_cleared", NOW, null]]);
  });

  it("an override that ends the stale state gives the override event, then unstale (rule 10, Q216)", () => {
    const b = mk({ createdAt: NOW - 2 * DAY, staleSince: NOW - DAY, wasStale: true });
    const change = setAlertOverride(b.id, 10 * 1440, [b], fixedClock(NOW));
    expect(kinds(deriveEvents([b], change, ctx())).map((k) => k[1])).toEqual(["override_set", "unstale"]);
  });

  it("done at doneAt, trashed at deletedAt, and one event per subtask that moves with its parent (FR-019, Edge Cases)", () => {
    const p = mk({ createdAt: T });
    const s1 = mk({ createdAt: T, parentId: p.id });
    const s2 = mk({ createdAt: T, parentId: p.id });
    const done = markDone(p.id, [p, s1, s2], fixedClock(NOW));
    expect(kinds(deriveEvents([p, s1, s2], done, ctx())).sort()).toEqual(
      [[p.id, "done", NOW, null], [s1.id, "done", NOW, null], [s2.id, "done", NOW, null]].sort(),
    );
    const trash = remove(p.id, [p, s1, s2], fixedClock(NOW));
    expect(kinds(deriveEvents([p, s1, s2], trash, ctx())).map((k) => k[1])).toEqual(["trashed", "trashed", "trashed"]);
  });

  it("018: Archive → Trash records trashed only, and Trash → Archive restored only (data-model.md)", () => {
    const p = mk({ createdAt: T, doneAt: T + DAY });
    const s1 = mk({ createdAt: T, parentId: p.id, doneAt: T + DAY, leftWithId: p.id });
    const toTrash = trashDone(p.id, [p, s1], fixedClock(NOW));
    expect(kinds(deriveEvents([p, s1], toTrash, ctx())).map((k) => k[1])).toEqual(["trashed", "trashed"]);
    const inTrash = toTrash.upserts;
    const back = restore(p.id, inTrash, fixedClock(NOW + MIN));
    expect(kinds(deriveEvents(inTrash, back, ctx({ now: NOW + MIN }))).map((k) => k[1])).toEqual(["restored", "restored"]);
  });

  it("a restore that makes a task stale gives restored, then stale at the real moment", () => {
    const b = mk({ createdAt: T, doneAt: T + HOUR });
    const back = restore(b.id, [b], fixedClock(NOW));
    const w = deriveEvents([b], back, ctx());
    expect(kinds(w)).toEqual([
      [b.id, "restored", NOW, null],
      [b.id, "stale", T + DAY, null],
    ]);
  });

  it("a move gives nothing", () => {
    const b = mk({ createdAt: T });
    expect(deriveEvents([b], cs([{ ...b, position: 99, updatedAt: NOW }]), ctx()).inserts).toEqual([]);
  });

  it("origin tick writes only stale, period only unstale, undo and import nothing", () => {
    const b = mk({ createdAt: T, staleSince: T + DAY, wasStale: true });
    const changed = cs([{ ...b, staleSince: null, doneAt: NOW }]);
    expect(kinds(deriveEvents([b], changed, ctx({ origin: "tick" })))).toEqual([]);
    expect(kinds(deriveEvents([b], changed, ctx({ origin: "period" }))).map((k) => k[1])).toEqual(["unstale"]);
    expect(deriveEvents([b], changed, ctx({ origin: "undo" })).inserts).toEqual([]);
    expect(deriveEvents([], cs([mk()]), ctx({ origin: "import" })).inserts).toEqual([]);
  });

  it("gives every event its own id from newId", () => {
    const p = mk({ createdAt: T });
    const s = mk({ createdAt: T, parentId: p.id });
    const ids = deriveEvents([p, s], markDone(p.id, [p, s], fixedClock(NOW)), ctx()).inserts.map((e) => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("015 SC-001: every path to the same choice records the same event (the tolerance, or a duration)", () => {
    const b = mk({ createdAt: T, staleSince: T + DAY, wasStale: true });
    // The hover click, the panel click, Enter or Space, the context menu and Edit › Reschedule all send forMin null;
    // the hold, Shift+Enter and both Postpone For submenus send the duration (FR-010a).
    for (const forMin of [null, 60, 120, 240, 360]) {
      const once = deriveEvents([b], reschedule(b.id, [b], fixedClock(NOW), DEFAULT_ALERT_SETTINGS, forMin), ctx()).inserts.map(({ id: _, ...e }) => e);
      const again = deriveEvents([b], reschedule(b.id, [b], fixedClock(NOW), DEFAULT_ALERT_SETTINGS, forMin), ctx()).inserts.map(({ id: _, ...e }) => e);
      expect(again).toEqual(once);
      // 016 FR-011 (Q229): the tolerance is now recorded too (ctx's 1440).
      expect(once).toEqual([{ taskId: b.id, kind: "rescheduled", at: NOW, detail: forMin ?? 1440 }]);
    }
  });
});

describe("015 Q214: override changes within a minute merge", () => {
  const b = mk({ createdAt: NOW - HOUR, alertOverrideMin: 2 * 1440 });
  const change = (minutes: number | null) => cs([{ ...b, alertOverrideMin: minutes }]);
  const last = (kind: TaskEvent["kind"], at: number): Map<string, TaskEvent> => new Map([[b.id, { id: "e-last", taskId: b.id, kind, at, detail: 2 * 1440, seq: 7 }]]);

  it("a change 30 s after a set updates that event: same id and kind, new time and minutes", () => {
    const w = deriveEvents([b], change(3 * 1440), ctx({ lastEvents: last("override_set", NOW - 30_000) }));
    expect(w.inserts).toEqual([]);
    expect(w.updates).toEqual([{ id: "e-last", taskId: b.id, kind: "override_set", at: NOW, detail: 3 * 1440, seq: 7 }]);
  });

  it("a change after a change merges too", () => {
    const w = deriveEvents([b], change(3 * 1440), ctx({ lastEvents: last("override_changed", NOW - 59_999) }));
    expect(w.updates.map((e) => e.kind)).toEqual(["override_changed"]);
  });

  it("at 60 s, after another event, or for a clear, it inserts", () => {
    expect(deriveEvents([b], change(3 * 1440), ctx({ lastEvents: last("override_set", NOW - 60_000) })).inserts.map((e) => e.kind)).toEqual(["override_changed"]);
    expect(deriveEvents([b], change(3 * 1440), ctx({ lastEvents: last("stale", NOW - 10_000) })).inserts.map((e) => e.kind)).toEqual(["override_changed"]);
    expect(deriveEvents([b], change(null), ctx({ lastEvents: last("override_set", NOW - 10_000) })).inserts.map((e) => e.kind)).toEqual(["override_cleared"]);
  });

  it("a subtask's events do not count: only the task's own latest event", () => {
    // lastEvents is per task, so another task's later event never ends the merge.
    const sub = mk({ createdAt: NOW - HOUR, parentId: b.id });
    const map = new Map([...last("override_set", NOW - 30_000), [sub.id, { id: "e-sub", taskId: sub.id, kind: "done" as const, at: NOW - 1000, detail: null }]]);
    expect(deriveEvents([b], change(3 * 1440), ctx({ lastEvents: map })).updates).toHaveLength(1);
  });
});

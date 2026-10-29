import { describe, expect, it } from "vitest";
import { deletePermanently, restore } from "../../../src/domain/actions";
import { DEFAULT_ALERT_SETTINGS } from "../../../src/domain/alert-settings";
import { fixedClock } from "../../../src/domain/clock";
import { DomainError, type Task } from "../../../src/domain/task";
import { archiveView } from "../../../src/domain/tree";
import { mk } from "./fixtures";

const clock = fixedClock(20_000);
const get = (cs: { upserts: Task[] }, id: string) => cs.upserts.find((t) => t.id === id);

describe("restore (FR-032, FR-036, FR-037)", () => {
  it("a parent brings back the subtasks still with it, in order, and clears leftWithId", () => {
    const p = mk({ doneAt: 5, createdAt: 1 });
    const s1 = mk({ parentId: p.id, position: 1, doneAt: 5, leftWithId: p.id });
    const s2 = mk({ parentId: p.id, position: 2, doneAt: 5, leftWithId: p.id });
    const doneEarlier = mk({ parentId: p.id, position: 3, doneAt: 2 });
    const cs = restore(p.id, [p, s1, s2, doneEarlier], clock);
    expect(get(cs, p.id)).toMatchObject({ doneAt: null, createdAt: 1, updatedAt: 20_000 });
    expect(get(cs, s1.id)).toMatchObject({ doneAt: null, leftWithId: null, position: 1 });
    expect(get(cs, s2.id)).toMatchObject({ doneAt: null, leftWithId: null, position: 2 });
    expect(get(cs, doneEarlier.id)).toBeUndefined();
  });

  it("a subtask that went with its parent, restored alone, becomes top-level at the end", () => {
    const top = mk({ position: 4 });
    const p = mk({ deletedAt: 5 });
    const s = mk({ parentId: p.id, deletedAt: 5, leftWithId: p.id });
    expect(get(restore(s.id, [top, p, s], clock), s.id)).toMatchObject({ parentId: null, position: 5, deletedAt: null, leftWithId: null });
  });

  it("restoring under an active collapsed parent expands it", () => {
    const p = mk({ collapsed: true });
    const s = mk({ parentId: p.id, doneAt: 3 });
    const cs = restore(s.id, [p, s], clock);
    expect(get(cs, p.id)?.collapsed).toBe(false);
    expect(get(cs, s.id)?.parentId).toBe(p.id);
  });

  it("only done or deleted rows can be restored", () => {
    const a = mk();
    expect(() => restore(a.id, [a], clock)).toThrow(DomainError);
  });
});

describe("deletePermanently (FR-034)", () => {
  it("removes a deleted row and the rows that went with it", () => {
    const p = mk({ deletedAt: 5 });
    const s = mk({ parentId: p.id, deletedAt: 5, leftWithId: p.id });
    const other = mk({ deletedAt: 5 });
    expect(deletePermanently(p.id, [p, s, other])).toEqual({ upserts: [], removals: [p.id, s.id] });
  });

  it("only works on rows in the Trash", () => {
    const done = mk({ doneAt: 1 });
    const active = mk();
    expect(() => deletePermanently(done.id, [done])).toThrow(DomainError);
    expect(() => deletePermanently(active.id, [active])).toThrow(DomainError);
  });
});

// 012 FR-028 (PRD Q162): a restored task kept its stale mark while done; restore evaluates it again.
describe("012 FR-028 restore after an alert period change", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const T = 1_000_000_000;
  const now = T + 2 * DAY;
  const at = fixedClock(now);
  const settings = { ...DEFAULT_ALERT_SETTINGS };

  it("FR-028 a restored stale task whose new moment is in the future comes back not stale, history kept", () => {
    const done = mk({ createdAt: T, staleBaseAt: T, staleSince: T + DAY, wasStale: true, lastBlinkAt: T + DAY, doneAt: now - HOUR, alertOverrideMin: 7 * 1440 });
    const back = get(restore(done.id, [done], at, settings), done.id);
    expect(back).toMatchObject({ doneAt: null, staleSince: null, lastBlinkAt: null, wasStale: true });
  });

  it("FR-028 a restored stale task whose moment has passed stays stale", () => {
    const done = mk({ createdAt: T, staleBaseAt: T, staleSince: T + DAY, wasStale: true, doneAt: now - HOUR });
    expect(get(restore(done.id, [done], at, settings), done.id)?.staleSince).toBe(T + DAY);
  });

  it("A4 rule 6 exception kept: a row past its threshold while done becomes stale at its real crossing moment", () => {
    const done = mk({ createdAt: T, staleBaseAt: T, doneAt: T + HOUR });
    expect(get(restore(done.id, [done], at, settings), done.id)).toMatchObject({ staleSince: T + DAY, firstBlinkCount: 3 });
  });
});

describe("018 restore from the Trash back to the Archive (FR-012, PRD Q281, Q283)", () => {
  it("a Trash row with keptDoneAt returns to the Archive with its group and that completion date", () => {
    const p = mk({ deletedAt: 9_000, keptDoneAt: 3_000 });
    const s1 = mk({ parentId: p.id, position: 1, deletedAt: 9_000, keptDoneAt: 3_000, leftWithId: p.id });
    const s2 = mk({ parentId: p.id, position: 2, deletedAt: 9_000, keptDoneAt: 2_000, leftWithId: p.id });
    const cs = restore(p.id, [p, s1, s2], clock);
    expect(get(cs, p.id)).toMatchObject({ deletedAt: null, doneAt: 3_000, keptDoneAt: null, leftWithId: null, updatedAt: 20_000 });
    expect(get(cs, s1.id)).toMatchObject({ deletedAt: null, doneAt: 3_000, keptDoneAt: null, leftWithId: p.id, updatedAt: 20_000 });
    expect(get(cs, s2.id)).toMatchObject({ deletedAt: null, doneAt: 2_000, keptDoneAt: null, leftWithId: p.id, updatedAt: 20_000 });
    const after = [p, s1, s2].map((t) => get(cs, t.id) ?? t);
    const entry = archiveView(after).find((e) => e.task.id === p.id);
    expect(entry?.subtasks.map((t) => t.id)).toEqual([s1.id, s2.id]);
  });

  it("a taken-along subtask restored alone returns to the Archive on its own", () => {
    const p = mk({ deletedAt: 9_000, keptDoneAt: 3_000 });
    const s = mk({ parentId: p.id, deletedAt: 9_000, keptDoneAt: 3_000, leftWithId: p.id });
    expect(get(restore(s.id, [p, s], clock), s.id)).toMatchObject({ deletedAt: null, doneAt: 3_000, keptDoneAt: null, leftWithId: null });
  });

  it("a Trash row without keptDoneAt restores to the active list, as before", () => {
    const t = mk({ deletedAt: 9_000 });
    expect(get(restore(t.id, [t], clock), t.id)).toMatchObject({ deletedAt: null, doneAt: null, keptDoneAt: null });
  });
});

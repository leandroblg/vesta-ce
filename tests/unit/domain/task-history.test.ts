/** 015 historyOf (research §3, data-model.md "HistoryEntry"; FR-016, FR-016b, FR-020, PRD Q210, Q217; T029). */
import { describe, expect, it } from "vitest";
import { historyOf, type TaskEvent } from "../../../src/domain/task-events";
import { mk } from "./fixtures";

const T = 1_000_000_000_000;
const HOUR = 3_600_000;
let n = 0;
const ev = (taskId: string, kind: TaskEvent["kind"], at: number, detail: number | null = null, seq?: number): TaskEvent => {
  n += 1;
  return { id: `e${String(n)}`, taskId, kind, at, detail, seq: seq ?? n };
};
const shape = (entries: ReturnType<typeof historyOf>) => entries.map((e) => [e.kind, e.at, e.detail, e.derived]);

describe("015 historyOf", () => {
  it("lists recorded events newest first (Q210), by time then recording order", () => {
    const t = mk({ createdAt: T });
    const events = [ev(t.id, "created", T), ev(t.id, "stale", T + 2 * HOUR), ev(t.id, "rescheduled", T + 3 * HOUR, 120), ev(t.id, "done", T + 3 * HOUR)];
    expect(shape(historyOf(t, events))).toEqual([
      ["done", T + 3 * HOUR, null, false],
      ["rescheduled", T + 3 * HOUR, 120, false],
      ["stale", T + 2 * HOUR, null, false],
      ["created", T, null, false],
    ]);
  });

  it("only the task's own events", () => {
    const t = mk({ createdAt: T });
    expect(historyOf(t, [ev(t.id, "created", T), ev("other", "done", T + 1)]).map((e) => e.kind)).toEqual(["created"]);
  });

  it("a task from before the table (no created event) shows the entries its stored dates give (FR-020)", () => {
    const t = mk({ createdAt: T, staleSince: T + 2 * HOUR, wasStale: true, doneAt: T + 5 * HOUR });
    expect(shape(historyOf(t, []))).toEqual([
      ["done", T + 5 * HOUR, null, true],
      ["stale", T + 2 * HOUR, null, true],
      ["created", T, null, true],
    ]);
  });

  it("Q217: one rescheduled after the upgrade keeps its derived Created and earlier dates, below its new events", () => {
    const t = mk({ createdAt: T, staleBaseAt: T + 10 * HOUR, wasStale: true, deletedAt: T + 20 * HOUR });
    const events = [ev(t.id, "rescheduled", T + 10 * HOUR), ev(t.id, "trashed", T + 20 * HOUR)];
    expect(shape(historyOf(t, events))).toEqual([
      ["trashed", T + 20 * HOUR, null, false],
      ["rescheduled", T + 10 * HOUR, null, false],
      ["wasStale", null, null, true],
      ["created", T, null, true],
    ]);
  });

  it("leaves out a derived entry a recorded event of the same kind and time covers", () => {
    const t = mk({ createdAt: T, doneAt: T + HOUR });
    const shown = historyOf(t, [ev(t.id, "done", T + HOUR)]);
    expect(shown.filter((e) => e.kind === "done")).toHaveLength(1);
    expect(shown.find((e) => e.kind === "done")?.derived).toBe(false);
  });

  it("adds a dateless Was stale just above Created when the task was stale and no stale entry is known", () => {
    const t = mk({ createdAt: T, wasStale: true, doneAt: T + 9 * HOUR });
    expect(shape(historyOf(t, []))).toEqual([
      ["done", T + 9 * HOUR, null, true],
      ["wasStale", null, null, true],
      ["created", T, null, true],
    ]);
  });

  it("no Was stale when a stale entry is listed, recorded or derived", () => {
    const t = mk({ createdAt: T, wasStale: true });
    const events = [ev(t.id, "created", T), ev(t.id, "stale", T + HOUR), ev(t.id, "rescheduled", T + 2 * HOUR)];
    expect(historyOf(t, events).map((e) => e.kind)).not.toContain("wasStale");
  });

  it("a task created after the upgrade (with its created event) gets no derived entries", () => {
    const t = mk({ createdAt: T, doneAt: T + HOUR, wasStale: true });
    expect(shape(historyOf(t, [ev(t.id, "created", T)]))).toEqual([["created", T, null, false]]);
  });
});

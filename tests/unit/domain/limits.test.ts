import { describe, expect, it } from "vitest";
import {
  MAX_DATA_JSON_BYTES,
  MAX_DETAILS_CHARS,
  MAX_FILE_NAME_CHARS,
  MAX_IMPORT_FILES,
  MAX_IMPORT_TOTAL_BYTES,
  MAX_LOG_CONTEXT_CHARS,
  MAX_LOG_MESSAGE_CHARS,
  MAX_LOG_STACK_CHARS,
  MAX_PATH_CHARS,
  MAX_REMINDER_CHARS,
  MAX_SEARCH_CHARS,
  MAX_TITLE_CHARS,
  MAX_TOKEN_CHARS,
  MAX_URL_CHARS,
  OVERRIDE_MAX_MINUTES,
  OVERRIDE_MIN_MINUTES,
  REMINDER_DAYS_DEFAULT,
  REMINDER_DAYS_MAX,
  REMINDER_DAYS_MIN,
  REMINDER_TIME_FIELDS,
  TASK_TIME_FIELDS,
  clampTimes,
  isUuid,
} from "../../../src/domain/limits";

describe("L1/L10/L14 shared limits (010 research §1, contracts/ipc.md)", () => {
  it("L1 holds the audit's values", () => {
    expect(MAX_TITLE_CHARS).toBe(10_000);
    expect(MAX_REMINDER_CHARS).toBe(10_000);
    expect(MAX_DETAILS_CHARS).toBe(1_000_000);
    expect(MAX_LOG_MESSAGE_CHARS).toBe(4_096);
    expect(MAX_LOG_STACK_CHARS).toBe(65_536);
    expect(MAX_LOG_CONTEXT_CHARS).toBe(200);
    expect(MAX_TOKEN_CHARS).toBe(64);
    expect(MAX_FILE_NAME_CHARS).toBe(255);
    expect(MAX_SEARCH_CHARS).toBe(10_000);
    expect(MAX_PATH_CHARS).toBe(4_096);
    expect(MAX_URL_CHARS).toBe(2_048);
    expect(OVERRIDE_MIN_MINUTES).toBe(60);
    expect(OVERRIDE_MAX_MINUTES).toBe(14_399_999);
  });

  it("L10 holds the import limits", () => {
    expect(MAX_DATA_JSON_BYTES).toBe(67_108_864);
    expect(MAX_IMPORT_FILES).toBe(10_000);
    expect(MAX_IMPORT_TOTAL_BYTES).toBe(4_294_967_296);
  });

  it("Q133 holds the reminder range", () => {
    expect(REMINDER_DAYS_MIN).toBe(7);
    expect(REMINDER_DAYS_MAX).toBe(365);
    expect(REMINDER_DAYS_DEFAULT).toBe(30);
  });

  it("L14 isUuid accepts the 8-4-4-4-12 shape in any case and refuses the rest", () => {
    expect(isUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D")).toBe(true);
    expect(isUuid("")).toBe(false);
    expect(isUuid("00000000-0000-4000-8000-00000000000")).toBe(false);
    expect(isUuid("00000000-0000-4000-8000-00000000000g")).toBe(false);
    expect(isUuid("not a uuid at all, just text that is long")).toBe(false);
  });

  it("L14 names the time fields of tasks and reminders", () => {
    expect([...TASK_TIME_FIELDS]).toEqual([
      "createdAt",
      "updatedAt",
      "doneAt",
      "deletedAt",
      "staleBaseAt",
      "staleSince",
      "lastBlinkAt",
      "lastSignalAt",
      "keptDoneAt",
    ]);
    expect([...REMINDER_TIME_FIELDS]).toEqual(["createdAt", "updatedAt", "doneAt", "deletedAt", "keptDoneAt"]);
  });

  it("018: clampTimes sets a keptDoneAt later than now to now, like doneAt", () => {
    const now = 1_000;
    const rows = [{ keptDoneAt: now + 500 as number | null }, { keptDoneAt: null as number | null }, { keptDoneAt: 10 as number | null }];
    const result = clampTimes(rows, ["keptDoneAt"], now);
    expect(result.rows.map((r) => r.keptDoneAt)).toEqual([now, null, 10]);
  });

  it("L14 clampTimes sets every later time to now, leaves the rest and counts exactly", () => {
    const now = 1_000_000;
    const rows = [
      { id: "a", createdAt: now + 1, updatedAt: now + 500_000, doneAt: null, deletedAt: now - 1 },
      { id: "b", createdAt: now, updatedAt: now - 10, doneAt: now + 2, deletedAt: null },
    ];
    const result = clampTimes(rows, ["createdAt", "updatedAt", "doneAt", "deletedAt"], now);
    expect(result.count).toBe(3);
    expect(result.rows).toEqual([
      { id: "a", createdAt: now, updatedAt: now, doneAt: null, deletedAt: now - 1 },
      { id: "b", createdAt: now, updatedAt: now - 10, doneAt: now, deletedAt: null },
    ]);
    // The input is not changed.
    expect(rows[0]?.createdAt).toBe(now + 1);
  });

  it("L14 clampTimes counts zero and returns equal rows when nothing is later than now", () => {
    const rows = [{ updatedAt: 5, createdAt: 1 }];
    const result = clampTimes(rows, ["createdAt", "updatedAt"], 5);
    expect(result.count).toBe(0);
    expect(result.rows).toEqual(rows);
  });
});

describe("011 editor limits (data-model \"Domain types\")", () => {
  it("FR-011 FR-012 FR-019 FR-020a hold the 011 values", async () => {
    const limits = await import("../../../src/domain/limits");
    expect(limits.MAX_PINNED_COLORS).toBe(10);
    expect(limits.MAX_RECENT_COLORS).toBe(20);
    expect(limits.MAX_TABLE_SIZE).toBe(100);
    expect(limits.GRID_MIN).toBe(8);
    expect(limits.GRID_MAX).toBe(20);
    expect(limits.LONG_PRESS_MS).toBe(500);
  });
});

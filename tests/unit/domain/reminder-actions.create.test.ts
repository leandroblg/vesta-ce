import { describe, expect, it } from "vitest";
import { fixedClock } from "../../../src/domain/clock";
import { MAX_ACTIVE_REMINDERS } from "../../../src/domain/reminder";
import { createReminder } from "../../../src/domain/reminder-actions";
import { DomainError } from "../../../src/domain/task";
import { id, idGen, mkReminder } from "./fixtures";

const clock = fixedClock(500);

describe("createReminder (FR-006, FR-007a, FR-008)", () => {
  it("adds one reminder at the end of the active reminders with the new id and normalized text", () => {
    const a = mkReminder({ position: 3 });
    const done = mkReminder({ position: 9, doneAt: 1 });
    const cs = createReminder({ text: "  Pick up\n dry cleaning " }, [a, done], clock, idGen(1));
    expect(cs).toEqual({
      upserts: [
        {
          id: id(1),
          textMd: "Pick up dry cleaning",
          position: 4,
          createdAt: 500,
          updatedAt: 500,
          doneAt: null,
          deletedAt: null,
          keptDoneAt: null,
          prevSiblingId: null,
          nextSiblingId: null,
        },
      ],
      removals: [],
      sectionCollapsed: null,
    });
  });

  it("starts at position 1 in an empty list", () => {
    expect(createReminder({ text: "First" }, [], clock, idGen(1)).upserts[0]?.position).toBe(1);
  });

  it("creates nothing for empty or whitespace-only text", () => {
    for (const text of ["", "   ", "\n\n"]) {
      expect(createReminder({ text }, [], clock, idGen(1))).toEqual({ upserts: [], removals: [], sectionCollapsed: null });
    }
  });

  it("keeps markdown as typed", () => {
    expect(createReminder({ text: "Call the bank before **Friday**" }, [], clock, idGen(1)).upserts[0]?.textMd).toBe(
      "Call the bank before **Friday**",
    );
  });

  it("creates with 199 active reminders and refuses with 200 (FR-007a)", () => {
    const active = Array.from({ length: MAX_ACTIVE_REMINDERS - 1 }, () => mkReminder());
    expect(createReminder({ text: "200th" }, active, clock, idGen(1)).upserts).toHaveLength(1);
    const full = [...active, mkReminder()];
    expect(() => createReminder({ text: "201st" }, full, clock, idGen(1))).toThrow(DomainError);
  });

  it("done and deleted reminders do not count toward the limit", () => {
    const active = Array.from({ length: MAX_ACTIVE_REMINDERS - 1 }, () => mkReminder());
    const gone = [mkReminder({ doneAt: 1 }), mkReminder({ deletedAt: 1 })];
    expect(createReminder({ text: "ok" }, [...active, ...gone], clock, idGen(1)).upserts).toHaveLength(1);
  });
});
